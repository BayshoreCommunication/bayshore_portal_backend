import type mongoose from "mongoose";
import { Client, type IClient } from "../models/client.model";
import type { IProject } from "../models/project.model";
import type { IReport } from "../models/report.model";
import { User, type IUser } from "../models/user.model";
import { env } from "../config/env";
import { activityEmail, emailReady, sendEmail, type ActivityEmail } from "./email";
import { REPORT_REVIEW_ROLES } from "./reportAccess";
import { onboardingDue, onboardingSteps } from "./onboardingEmails";

// Emails for what happens outside a piece of content (whose own are in utils/notifications.ts):
// a client added, a report handed in or published, a project started. The client hears what the
// team does, with a button into the client portal; the staff on the client hear what the client
// does — and what needs them — with a button into the team's portal. Nobody is emailed about
// their own action.
//
// An email is a courtesy: none of these ever throws, so a failure can't undo or fail the action
// it reports. It is logged instead.

type Id = mongoose.Types.ObjectId;
type Person = { fullName: string; email?: string };
type Look = Omit<ActivityEmail, "name">;

const quietly =
  <Args extends unknown[]>(work: (...args: Args) => Promise<unknown>) =>
  async (...args: Args): Promise<void> => {
    if (!emailReady) return;
    try {
      await work(...args);
    } catch (error) {
      console.error("Activity email failed:", error);
    }
  };

// Sends the same email to each person who has an address, by name.
const emailEach = (people: Person[], look: Look) =>
  Promise.all(people.filter((person) => person.email).map((person) => sendEmail({ to: person.email as string, ...activityEmail({ name: person.fullName, ...look }) })));

// A client's active logins.
const clientLoginsOf = (clientId: Id | string, except?: Id): Promise<Person[]> =>
  User.find({ role: "client", client: clientId, status: "active", ...(except ? { _id: { $ne: except } } : {}) })
    .select("fullName email")
    .lean();

// The staff on a client — its account manager, its team, whoever added it — who can still sign in.
const staffOn = async (client: Pick<IClient, "accountManager" | "team" | "createdBy">, except?: Id, roles?: readonly string[]): Promise<Person[]> => {
  const ids = [client.accountManager, ...(client.team ?? []), client.createdBy].filter((id): id is Id => Boolean(id)).map(String);
  return User.find({
    _id: { $in: [...new Set(ids)].filter((id) => id !== String(except)) },
    status: "active",
    role: roles ? { $in: roles } : { $ne: "client" },
  })
    .select("fullName email")
    .lean();
};

const clientUrl = (path: string) => `${env.clientPortalUrl}${path}`;
const teamUrl = (path: string) => `${env.companyPortalUrl}${path}`;
const day = (date?: Date) => (date ? new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : undefined);

// ── A client added ───────────────────────────────────────────────────────────

// The team added a client: a welcome to the client — with the way in, when they were given a
// login: the email to sign in with and the password the team set — and word to the staff put on it.
// A client given a login who still has onboarding to do is asked, as one who signs up is, to fill
// in the onboarding form and book the onboarding call (utils/onboardingEmails.ts).
export const emailClientAdded = quietly(async (client: IClient, actor: IUser, password?: string) => {
  const manager = client.accountManager ? await User.findById(client.accountManager).select("fullName email").lean() : null;
  const onboarding = password && onboardingDue(client);

  await sendEmail({
    to: client.email,
    ...activityEmail({
      name: client.contactName,
      eyebrow: "Welcome",
      tone: "success",
      title: `Welcome to BayShore Communication, ${client.companyName}`,
      body: onboarding
        ? "Your client portal is ready. Sign in with the details below, then take the two quick steps that get us started. Please keep your password private."
        : password
          ? "Your client portal is ready. Sign in with the details below to follow your content, reports and projects, and to reach your team any time. Please keep your password private."
          : "We're glad to be working with you. Your BayShore team will be in touch with your next steps.",
      list: onboarding ? onboardingSteps(client) : undefined,
      details: [
        ["Company", client.companyName],
        ["Sign-in email", password ? client.email : undefined],
        ["Password", password],
        ["Your account manager", manager?.fullName],
        ["Services", client.serviceTypes.join(", ")],
      ],
      button: password
        ? { label: onboarding ? "Sign in and get started" : "Sign in to your portal", url: onboarding ? clientUrl(`/sign-in?callbackUrl=${encodeURIComponent("/onboarding")}`) : clientUrl("/sign-in") }
        : undefined,
    }),
  });

  await emailEach(await staffOn(client, actor._id), {
    eyebrow: "New client",
    tone: "info",
    title: `You're on ${client.companyName}`,
    body: `${actor.fullName} added ${client.companyName} and put you on the account.`,
    details: [
      ["Company", client.companyName],
      ["Contact", [client.contactName, client.email].filter(Boolean).join(" · ")],
      ["Account manager", manager?.fullName],
      ["Start date", day(client.startDate)],
    ],
    button: { label: "Open the client", url: teamUrl(`/clients/${client._id}`) },
    audience: "team",
  });
});

// The team gave an existing client a portal login, or set a new password for theirs: the
// client gets the email to sign in with and the password.
export const emailPortalLogin = quietly(async (client: IClient, password: string, created: boolean) => {
  // A first login for a client with onboarding still to do: ask for it, as the welcome does.
  const onboarding = created && onboardingDue(client);
  await sendEmail({
    to: client.email,
    ...activityEmail({
      name: client.contactName,
      eyebrow: created ? "Your portal is ready" : "Password changed",
      tone: created ? "success" : "alert",
      title: created ? "Your BayShore client portal login" : "Your portal password was changed",
      body: created
        ? "Your BayShore team set up your client portal. Sign in with the details below. Please keep your password private."
        : "Your BayShore team set a new password for your client portal. Sign in with the details below. If you didn't ask for this, reply to this email.",
      list: onboarding ? onboardingSteps(client) : undefined,
      details: [
        ["Company", client.companyName],
        ["Sign-in email", client.email],
        ["Password", password],
      ],
      button: onboarding
        ? { label: "Sign in and get started", url: clientUrl(`/sign-in?callbackUrl=${encodeURIComponent("/onboarding")}`) }
        : { label: "Sign in to your portal", url: clientUrl("/sign-in") },
    }),
  });
});

// ── Reports ──────────────────────────────────────────────────────────────────

// A report moved on: handed in for review (the reviewers on the client hear), or published (the
// client hears it's ready to read).
export const emailReportStatus = quietly(async (report: IReport, actor: IUser) => {
  const client = await Client.findById(report.client).select("companyName accountManager team createdBy").lean();
  if (!client) return;
  const period = [day(report.periodStart), day(report.periodEnd)].filter(Boolean).join(" – ");

  if (report.status === "submitted") {
    // The reviewers on this client — and, so a report never waits on nobody, every admin.
    const onClient = await staffOn(client, actor._id, REPORT_REVIEW_ROLES);
    const admins: Person[] = await User.find({ role: { $in: ["admin", "superadmin"] }, status: "active", _id: { $ne: actor._id } }).select("fullName email").lean();
    const reviewers = [...new Map([...onClient, ...admins].map((person) => [person.email, person])).values()];
    await emailEach(reviewers, {
      eyebrow: "Ready for review",
      tone: "alert",
      title: `${client.companyName}'s report is ready for review`,
      body: `${actor.fullName} handed in “${report.title}”. Approve it, or send it back with what to change.`,
      details: [
        ["Client", client.companyName],
        ["Report", report.title],
        ["Period", period],
      ],
      button: { label: "Review the report", url: teamUrl(`/monthly-reports/${report._id}`) },
      audience: "team",
    });
  }

  if (report.status === "published") {
    await emailEach(await clientLoginsOf(report.client), {
      eyebrow: "New report",
      tone: "success",
      title: `Your ${report.title} is ready`,
      body: "Your latest performance report is in your portal: what we did, how it went, and what comes next.",
      details: [
        ["Report", report.title],
        ["Period", period],
      ],
      button: { label: "Read your report", url: clientUrl(`/reports/${report._id}`) },
    });
  }
});

// ── Projects ─────────────────────────────────────────────────────────────────

// A project was started: by the team (the client hears), or asked for by the client (the staff
// on it hear).
export const emailProjectCreated = quietly(async (project: IProject, actor: IUser) => {
  const client = await Client.findById(project.client).select("companyName accountManager team createdBy").lean();
  if (!client) return;

  if (project.requestedBy === "client") {
    await emailEach(await staffOn(client, actor._id), {
      eyebrow: "New request",
      tone: "alert",
      title: `${client.companyName} asked for a new project`,
      body: project.description ? project.description.slice(0, 280) : `${actor.fullName} sent a new project request.`,
      details: [
        ["Client", client.companyName],
        ["Project", project.name],
      ],
      button: { label: "Open the project", url: teamUrl(`/projects/${project._id}`) },
      audience: "team",
    });
    return;
  }

  await emailEach(await clientLoginsOf(project.client, actor._id), {
    eyebrow: "New project",
    tone: "action",
    title: `We've started a new project for you: ${project.name}`,
    body: project.description ? project.description.slice(0, 280) : "Follow its progress, files and updates in your portal.",
    details: [["Project", project.name]],
    button: { label: "View the project", url: clientUrl(`/projects/${project._id}`) },
  });
});

// ── Messages ─────────────────────────────────────────────────────────────────

// A new message in a client's conversation, to the other side — once while it's unread, not
// once per message. `link` is the page the portal notification opens.
export const emailNewMessage = quietly(
  async (recipients: Id[], { side, from, title, body, link }: { side: "client" | "team"; from: string; title: string; body: string; link: string }) => {
    const people: Person[] = await User.find({ _id: { $in: recipients } }).select("fullName email").lean();
    // The team wrote: it goes to the client. The client wrote: to the team.
    const toClient = side === "team";
    await emailEach(people, {
      eyebrow: "New message",
      tone: "info",
      title,
      body,
      details: [["From", from]],
      button: { label: "Reply in the portal", url: toClient ? clientUrl(link) : teamUrl(link) },
      audience: toClient ? "client" : "team",
    });
  }
);
