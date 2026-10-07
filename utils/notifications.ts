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

// Telling the other side that something happened on a piece of content. Called by the
// content controller after the change itself is saved.
//
// The client's logins hear about what the team does; the staff on that client — its account
// manager, its team, whoever added the client and whoever made the piece — hear about what
// the client does. Nobody is told about their own action.
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

const deliver = (
  recipients: Id[],
  notification: { type: NotificationType; title: string; body?: string; content: IContent; actor: IUser; pieces?: number }
) =>
  recipients.length
    ? Notification.insertMany(
        recipients.map((recipient) => ({
          recipient,
          type: notification.type,
          title: clip(notification.title, NOTIFICATION_TITLE_MAX_LENGTH),
          body: notification.body ? clip(notification.body, NOTIFICATION_BODY_MAX_LENGTH) : undefined,
          link: linkTo(notification.content),
          actor: notification.actor._id,
          actorName: notification.actor.fullName,
          client: notification.content.client,
          content: notification.content._id,
          pieces: notification.pieces ?? 1,
        }))
      )
    : [];

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
  });
});

// ── Clearing up ──────────────────────────────────────────────────────────────

// A deleted piece's notifications would only lead to "not found".
export const forgetContentNotifications = quietly(async (contentId: Id) => {
  await Notification.deleteMany({ content: contentId });
});
