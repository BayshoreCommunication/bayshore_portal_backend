import type mongoose from "mongoose";
import {
  Notification,
  NOTIFICATION_BODY_MAX_LENGTH,
  NOTIFICATION_TITLE_MAX_LENGTH,
  type NotificationType,
} from "../models/notification.model";
import { Client } from "../models/client.model";
import { User, type IUser } from "../models/user.model";
import type { IContent } from "../models/content.model";
import type { IReport } from "../models/report.model";
import type { IProject } from "../models/project.model";
import { emitToUsers } from "../realtime/messagesRealtime";
import { env } from "../config/env";
import { activityEmail, emailReady, sendEmail, type EmailTone } from "./email";

// Telling the other side that something happened on a piece of content. Called by the
// content controller after the change itself is saved.
//
// The client's logins hear about what the team does; the staff on that client — its account
// manager, its team, whoever added the client and whoever made the piece — hear about what
// the client does. Nobody is told about their own action.
//
// Everything is also sent by email (`email` below), to whoever has an address: the client's
// logins with a button into the client portal, the staff with one into the team's portal —
// when email is set up (see utils/email.ts).
//
// A notification is a courtesy: none of these ever throws, so a failure here can't undo or
// fail the action it reports. It is logged instead.

type Id = mongoose.Types.ObjectId;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// The start of a comment — or, for one that is only files, how many were attached.
const excerptOf = (text: string | undefined, attachments: number) =>
  text?.trim() ? `“${text.trim()}”` : `${attachments} ${attachments === 1 ? "file" : "files"} attached`;

// Both portals open a piece at the same path.
const linkTo = (content: Pick<IContent, "_id">) => `/content/${content._id}`;

// Active client logins for a client.
const clientLoginsOf = (clientId: Id): Promise<Id[]> => User.find({ role: "client", client: clientId, status: "active" }).distinct("_id");

// The staff to tell about a client's action on a piece, and the client's name for the message.
const staffOn = async (content: IContent, except?: Id) => {
  const client = await Client.findById(content.client).select("companyName accountManager team createdBy").lean();
  const candidates = [client?.accountManager, ...(client?.team ?? []), client?.createdBy, content.createdBy]
    .filter((id): id is Id => Boolean(id))
    .map(String);
  const ids = [...new Set(candidates)].filter((id) => id !== String(except));
  // Only people who can still sign in — and never a client login that ended up on the list.
  const recipients: Id[] = await User.find({ _id: { $in: ids }, status: "active", role: { $ne: "client" } }).distinct("_id");
  return { recipients, company: client?.companyName ?? "A client" };
};

// How each kind of notification looks as an email: its label, colour and button.
const EMAIL_LOOK: Record<NotificationType, { eyebrow: string; tone: EmailTone; button: string }> = {
  content_sent: { eyebrow: "Needs your approval", tone: "action", button: "Review the content" },
  content_resubmitted: { eyebrow: "Updated for you", tone: "action", button: "Review the changes" },
  onboarding_comment: { eyebrow: "Onboarding comment", tone: "info", button: "Open the onboarding" },
  content_comment: { eyebrow: "New reply", tone: "info", button: "Read the reply" },
  content_feedback: { eyebrow: "Client feedback", tone: "alert", button: "Open the piece" },
  content_approved: { eyebrow: "Approved", tone: "success", button: "Open the piece" },
  content_caption_edited: { eyebrow: "Caption edited", tone: "info", button: "See what changed" },
  message: { eyebrow: "New message", tone: "info", button: "Read the message" },
  report_published: { eyebrow: "New report", tone: "success", button: "Read your report" },
  project_created: { eyebrow: "New project", tone: "action", button: "View the project" },
  client_signed_up: { eyebrow: "New client", tone: "success", button: "Open the client" },
  onboarding_call_booked: { eyebrow: "Call booked", tone: "success", button: "Open the onboarding" },
};

// The same notification by email, to those of the recipients who have an address. Clients get
// a button into the client portal; the team, into theirs.
const emailTo = async (
  recipients: Id[],
  { type, title, body, content, audience }: { type: NotificationType; title: string; body?: string; content: IContent; audience: "client" | "team" }
) => {
  if (!emailReady) return;
  const people = await User.find({ _id: { $in: recipients }, email: { $nin: [null, ""] } }).select("fullName email").lean();
  const look = EMAIL_LOOK[type];
  const url = `${audience === "client" ? env.clientPortalUrl : env.companyPortalUrl}${linkTo(content)}`;
  const company = audience === "team" ? (await Client.findById(content.client).select("companyName").lean())?.companyName : undefined;
  await Promise.all(
    people.map((person) =>
      sendEmail({
        to: person.email as string,
        ...activityEmail({
          name: person.fullName,
          title,
          body,
          eyebrow: look.eyebrow,
          tone: look.tone,
          details: [
            ["Content", content.title],
            ["Client", company],
          ],
          button: { label: look.button, url },
          audience,
        }),
      })
    )
  );
};

const deliver = async (
  recipients: Id[],
  notification: {
    type: NotificationType;
    title: string;
    body?: string;
    content: IContent;
    actor: IUser;
    pieces?: number;
    // Also send it by email, as to a client or to the team.
    email?: "client" | "team";
  }
) => {
  if (!recipients.length) return;
  const title = clip(notification.title, NOTIFICATION_TITLE_MAX_LENGTH);
  const body = notification.body ? clip(notification.body, NOTIFICATION_BODY_MAX_LENGTH) : undefined;
  await Notification.insertMany(
    recipients.map((recipient) => ({
      recipient,
      type: notification.type,
      title,
      body,
      link: linkTo(notification.content),
      actor: notification.actor._id,
      actorName: notification.actor.fullName,
      client: notification.content.client,
      content: notification.content._id,
      pieces: notification.pieces ?? 1,
    }))
  );
  if (notification.email) await emailTo(recipients, { type: notification.type, title, body, content: notification.content, audience: notification.email });
};

// Runs the work and swallows (logs) whatever goes wrong.
const quietly =
  <Args extends unknown[]>(work: (...args: Args) => Promise<unknown>) =>
  async (...args: Args): Promise<void> => {
    try {
      await work(...args);
    } catch (error) {
      console.error("Notification failed:", error);
    }
  };

// ── To the client ────────────────────────────────────────────────────────────

const sentTitle = (pieces: number) =>
  pieces === 1 ? "New content is ready for your approval" : `${pieces} new pieces are ready for your approval`;
const sentBody = (first: string, pieces: number) => (pieces === 1 ? first : `${first} and ${pieces - 1} more`);

// Pieces sent close together are one notification, not one each: several saved together on
// the Add Content page, or a batch of drafts sent one after another.
const SENT_TOGETHER_MS = 10 * 60 * 1000;

// The team sent one or more pieces (all for the same client) for approval.
export const notifyContentSent = quietly(async (pieces: IContent[], actor: IUser) => {
  const [first] = pieces;
  if (!first) return;

  for (const recipient of await clientLoginsOf(first.client)) {
    // Still unread and only just sent? Add these to it rather than piling up another.
    const recent = await Notification.findOne({
      recipient,
      type: "content_sent",
      client: first.client,
      readAt: null,
      createdAt: { $gte: new Date(Date.now() - SENT_TOGETHER_MS) },
    }).sort({ createdAt: -1 });

    // (No second email either: the first one already says content is waiting.)
    if (recent) {
      recent.pieces += pieces.length;
      recent.title = sentTitle(recent.pieces);
      // Its body already starts with the first piece's title — keep that, recount the rest.
      const firstTitle = recent.body?.replace(/ and \d+ more$/, "") || first.title;
      recent.body = clip(sentBody(firstTitle, recent.pieces), NOTIFICATION_BODY_MAX_LENGTH);
      await recent.save();
      continue;
    }

    await deliver([recipient], {
      type: "content_sent",
      title: sentTitle(pieces.length),
      body: sentBody(first.title, pieces.length),
      content: first,
      actor,
      pieces: pieces.length,
      email: "client",
    });
  }
});

// The team made the changes the client asked for and sent the piece back.
export const notifyContentResubmitted = quietly(async (content: IContent, actor: IUser) => {
  await deliver(await clientLoginsOf(content.client), {
    type: "content_resubmitted",
    title: "Updated content is ready for your approval",
    body: content.title,
    content,
    actor,
    email: "client",
  });
});

// The team replied on a piece's comments. A draft's comments are the team's own — the client can't see them yet.
export const notifyTeamReply = quietly(async (content: IContent, actor: IUser, text: string | undefined, attachments: number) => {
  if (content.status === "draft") return;
  await deliver(await clientLoginsOf(content.client), {
    type: "content_comment",
    title: `New reply on “${content.title}”`,
    body: `${actor.fullName}: ${excerptOf(text, attachments)}`,
    content,
    actor,
    email: "client",
  });
});

// ── To the staff on the client ───────────────────────────────────────────────

// The client asked for changes.
export const notifyClientFeedback = quietly(
  async (content: IContent, actor: IUser, text: string | undefined, attachments: number, asksForChanges = true) => {
    const { recipients, company } = await staffOn(content, actor._id);
    await deliver(recipients, {
      type: "content_feedback",
      // A plain message — or anything on an approved piece — doesn't send the piece back.
      title: asksForChanges ? `${company} asked for changes` : `${company} sent a message`,
      body: `${content.title} — ${excerptOf(text, attachments)}`,
      content,
      actor,
      email: "team",
    });
  }
);

// The client approved a piece.
export const notifyClientApproved = quietly(async (content: IContent, actor: IUser, comment?: string) => {
  const { recipients, company } = await staffOn(content, actor._id);
  await deliver(recipients, {
    type: "content_approved",
    title: `${company} approved a piece`,
    body: comment ? `${content.title} — ${excerptOf(comment, 0)}` : content.title,
    content,
    actor,
    email: "team",
  });
});

// The client rewrote a piece's caption and/or tags (`changed` names which).
export const notifyClientEditedCaption = quietly(async (content: IContent, actor: IUser, changed: string[]) => {
  const { recipients, company } = await staffOn(content, actor._id);
  await deliver(recipients, {
    type: "content_caption_edited",
    title: `${company} edited the ${changed.join(" and ")}`,
    body: content.title,
    content,
    actor,
    email: "team",
  });
});

// ── To the client, about more than a piece ───────────────────────────────────

// In the client's bell too, for what they are already emailed about by utils/activityEmails.ts
// (a report published, a project started) — so no second email goes with it.
const notifyClientLogins = async (
  clientId: Id,
  actor: IUser,
  { type, title, body, link }: { type: NotificationType; title: string; body?: string; link: string }
) => {
  const recipients = (await clientLoginsOf(clientId)).filter((id) => String(id) !== String(actor._id));
  if (!recipients.length) return;
  await Notification.insertMany(
    recipients.map((recipient) => ({
      recipient,
      type,
      title: clip(title, NOTIFICATION_TITLE_MAX_LENGTH),
      body: body ? clip(body, NOTIFICATION_BODY_MAX_LENGTH) : undefined,
      link,
      actor: actor._id,
      actorName: actor.fullName,
      client: clientId,
      pieces: 1,
    }))
  );
  emitToUsers(recipients.map(String), "notifications:new", { type, client: String(clientId) });
};

// A report was published for the client.
export const notifyReportPublished = quietly(async (report: IReport, actor: IUser) => {
  await notifyClientLogins(report.client, actor, {
    type: "report_published",
    title: `Your ${report.title} is ready`,
    body: "Your latest performance report is in your portal.",
    link: `/reports/${report._id}`,
  });
});

// The team started a project for the client. (One the client asked for themselves, they know about.)
export const notifyProjectCreated = quietly(async (project: IProject, actor: IUser) => {
  if (project.requestedBy === "client") return;
  await notifyClientLogins(project.client, actor, {
    type: "project_created",
    title: `We've started a new project for you: ${project.name}`,
    body: project.description?.slice(0, NOTIFICATION_BODY_MAX_LENGTH),
    link: `/projects/${project._id}`,
  });
});

// ── Clearing up ──────────────────────────────────────────────────────────────

// A deleted piece's notifications would only lead to "not found".
export const forgetContentNotifications = quietly(async (contentId: Id) => {
  await Notification.deleteMany({ content: contentId });
});

// ── Comments on the onboarding form ──────────────────────────────────────────

// The staff on a client — or, when nobody is on it yet (one who signed up themselves), those
// who manage clients.
const staffOrManagersOf = async (clientId: Id, except?: Id): Promise<{ recipients: Id[]; company: string }> => {
  const client = await Client.findById(clientId).select("companyName accountManager team createdBy").lean();
  const ids = [...new Set([client?.accountManager, ...(client?.team ?? []), client?.createdBy].filter((id): id is Id => Boolean(id)).map(String))].filter(
    (id) => id !== String(except)
  );
  let recipients: Id[] = await User.find({ _id: { $in: ids }, status: "active", role: { $ne: "client" } }).distinct("_id");
  if (!recipients.length) recipients = await User.find({ role: { $in: ["manager", "admin", "superadmin"] }, status: "active" }).distinct("_id");
  return { recipients, company: client?.companyName ?? "A client" };
};

// Something the client did on their onboarding, to the team: in the bell at once (no email).
const notifyTeamOfClient = async (clientId: Id, actor: IUser, notification: { type: NotificationType; title: (company: string) => string; body?: string; link: string }) => {
  const { recipients, company } = await staffOrManagersOf(clientId, actor._id);
  if (!recipients.length) return;
  await Notification.insertMany(
    recipients.map((recipient) => ({
      recipient,
      type: notification.type,
      title: clip(notification.title(company), NOTIFICATION_TITLE_MAX_LENGTH),
      body: notification.body ? clip(notification.body, NOTIFICATION_BODY_MAX_LENGTH) : undefined,
      link: notification.link,
      actor: actor._id,
      actorName: actor.fullName,
      client: clientId,
      pieces: 1,
    }))
  );
  emitToUsers(recipients.map(String), "notifications:new", { type: notification.type, client: String(clientId) });
};

// A client made their own account (the front page of the client portal).
export const notifyClientSignedUp = quietly(async (clientId: Id, actor: IUser) => {
  await notifyTeamOfClient(clientId, actor, {
    type: "client_signed_up",
    title: (company) => `${company} created a client account`,
    body: [actor.fullName, actor.email].filter(Boolean).join(" · "),
    link: `/clients/${clientId}`,
  });
});

// A client said they booked their onboarding call ("I've booked my call").
export const notifyCallBooked = quietly(async (clientId: Id, actor: IUser) => {
  await notifyTeamOfClient(clientId, actor, {
    type: "onboarding_call_booked",
    title: (company) => `${company} booked their onboarding call`,
    body: "The date and time are in the Google Calendar booking.",
    link: `/clients/${clientId}/onboarding`,
  });
});

// A comment (or a reply) on a step of the client's onboarding form, to the other side: from the
// client, to the staff on them; from the team, to the client's logins. Their bell updates at once.
export const notifyOnboardingComment = quietly(
  async (clientId: Id, actor: IUser, input: { side: "client" | "team"; step: string; text?: string; attachments: number; reply?: boolean }) => {
    const client = await Client.findById(clientId).select("companyName accountManager team createdBy").lean();
    const company = client?.companyName ?? "A client";
    let recipients: Id[];
    if (input.side === "client") {
      const ids = [...new Set([client?.accountManager, ...(client?.team ?? []), client?.createdBy].filter((id): id is Id => Boolean(id)).map(String))].filter((id) => id !== String(actor._id));
      recipients = await User.find({ _id: { $in: ids }, status: "active", role: { $ne: "client" } }).distinct("_id");
      // Nobody on the client yet (one who signed up themselves): those who manage clients hear it.
      if (!recipients.length) recipients = await User.find({ role: { $in: ["manager", "admin", "superadmin"] }, status: "active" }).distinct("_id");
    } else {
      recipients = (await clientLoginsOf(clientId)).filter((id) => String(id) !== String(actor._id));
    }
    if (!recipients.length) return;

    const title =
      input.side === "client"
        ? `${company} ${input.reply ? "replied" : "commented"} on their onboarding`
        : `${actor.fullName} ${input.reply ? "replied to your comment" : "commented"} on your onboarding`;
    await Notification.insertMany(
      recipients.map((recipient) => ({
        recipient,
        type: "onboarding_comment" as const,
        title: clip(title, NOTIFICATION_TITLE_MAX_LENGTH),
        body: clip(`${input.step} — ${excerptOf(input.text, input.attachments)}`, NOTIFICATION_BODY_MAX_LENGTH),
        link: input.side === "client" ? `/clients/${clientId}/onboarding` : "/onboarding",
        actor: actor._id,
        actorName: actor.fullName,
        client: clientId,
        pieces: 1,
      }))
    );
    emitToUsers(recipients.map(String), "notifications:new", { type: "onboarding_comment", client: String(clientId) });

    // And by email, every time: the client with a button into their onboarding, the team into
    // the client's onboarding page.
    if (!emailReady) return;
    const audience = input.side === "client" ? "team" : "client";
    const look = EMAIL_LOOK.onboarding_comment;
    const url = audience === "client" ? `${env.clientPortalUrl}/onboarding` : `${env.companyPortalUrl}/clients/${clientId}/onboarding`;
    const people = await User.find({ _id: { $in: recipients }, email: { $nin: [null, ""] } }).select("fullName email").lean();
    await Promise.all(
      people.map((person) =>
        sendEmail({
          to: person.email as string,
          ...activityEmail({
            name: person.fullName,
            title,
            body: excerptOf(input.text, input.attachments),
            eyebrow: look.eyebrow,
            tone: look.tone,
            details: [
              ["Step", input.step],
              ["From", input.side === "client" ? company : actor.fullName],
              ["Client", audience === "team" ? company : undefined],
            ],
            button: { label: look.button, url },
            audience,
          }),
        })
      )
    );
  }
);
