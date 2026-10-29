import { env } from "../config/env";
import { Client, type IClient } from "../models/client.model";
import { activityEmail, emailReady, sendEmail, type ActivityEmail } from "./email";

// The emails that walk a new client through onboarding:
//   1. Welcome — when their portal account is made: how to sign in, and the two things to do
//      first: fill in the onboarding form and book the onboarding call.
//   2. Reminder — 3 hours after the welcome, if the call still isn't booked: the form can wait;
//      book the call, and a marketing specialist fills it in with them on it (see startOnboardingReminders).
//      Booking before then means no reminder: only clients not booked are looked for.
//   3. Call booked — the moment they say they've booked it ("I've booked my call"), at any point:
//      what the call is for. Never waits for the reminder check.
// Each goes once; what has gone out is kept on the client (client.onboardingEmails). Like every
// email here, none of them ever throws: a failure is logged, and whatever caused it carries on.

const HOUR = 60 * 60 * 1000;

// A page of the client portal, through signing in: whoever isn't signed in logs in first, and
// lands on it after.
const portalPage = (path: string) => `${env.clientPortalUrl}/sign-in?callbackUrl=${encodeURIComponent(path)}`;
const LOGIN_URL = `${env.clientPortalUrl}/sign-in`;
const FORM_URL = portalPage("/onboarding");
// The onboarding page with its "Book your onboarding call" card open (client-portal: KickoffCallCard).
const BOOK_URL = portalPage("/onboarding?book=1");

const ON_THE_CALL = [
  "Go over everything you filled out",
  "Help you fill in anything that's missing",
  "Collect everything we need to get started",
  "Plan your next steps with you",
];

export const callBookedOf = (client: Pick<IClient, "onboarding">) => client.onboarding?.kickoffCall?.booked === true;
const formDoneOf = (client: Pick<IClient, "onboarding">) => client.onboarding?.status === "submitted";
// The onboarding page is one the client is shown (no menus set means all of them).
const seesOnboarding = (client: Pick<IClient, "portalMenus">) => !client.portalMenus || client.portalMenus.includes("onboarding");

// Whether a client still has onboarding to do — the form or the call — that the portal lets them do.
export const onboardingDue = (client: Pick<IClient, "onboarding" | "portalMenus">) => seesOnboarding(client) && !(formDoneOf(client) && callBookedOf(client));

// The two first steps, for a welcome: what is left of them.
export const onboardingSteps = (client: Pick<IClient, "onboarding">): ActivityEmail["list"] => {
  const items = [
    formDoneOf(client) ? null : "Fill in your onboarding form. It takes about 5 minutes, and your answers save as you go.",
    callBookedOf(client) ? null : "Book your onboarding call. Pick a time that suits you.",
  ].filter((item): item is string => Boolean(item));
  return items.length ? { title: "Your next steps", items, numbered: true } : undefined;
};

const send = (client: IClient, look: Omit<ActivityEmail, "name">) => sendEmail({ to: client.email, ...activityEmail({ name: client.contactName, ...look }) });

const logFailure = (what: string, error: unknown) => console.error(`Onboarding email (${what}) failed:`, error);

// ── 1. Welcome ───────────────────────────────────────────────────────────────

// A client made their own account (the front page of the client portal). They chose the
// password themselves, so it isn't in the email.
export const emailOnboardingWelcome = async (client: IClient): Promise<void> => {
  if (!emailReady) return;
  try {
    const sent = await send(client, {
      eyebrow: "Welcome",
      tone: "success",
      title: "Welcome to BayShore Communication",
      body: "Your client portal is ready. Two quick things get us started, and you can do them in any order.",
      list: onboardingSteps(client),
      details: [
        ["Company", client.companyName],
        ["Sign-in email", client.email],
      ],
      button: { label: "Sign in and get started", url: FORM_URL },
      link: { label: "Or book your onboarding call now", url: BOOK_URL },
    });
    if (sent) await Client.updateOne({ _id: client._id }, { $set: { "onboardingEmails.welcomeSentAt": new Date() } });
  } catch (error) {
    logFailure("welcome", error);
  }
};

// ── 3. Call booked ───────────────────────────────────────────────────────────

// The client says they've booked their onboarding call. Sent once, however often it is said: the
// send is claimed on the record first, and given back if it can't go out, so a later save tries again.
export const emailCallBooked = async (client: IClient): Promise<void> => {
  if (!emailReady) return;
  try {
    const claimed = await Client.updateOne(
      { _id: client._id, "onboardingEmails.callBookedSentAt": { $exists: false } },
      { $set: { "onboardingEmails.callBookedSentAt": new Date() } }
    );
    if (!claimed.modifiedCount) return;

    // No date or time: the booking is on Google Calendar, which doesn't tell us.
    const sent = await send(client, {
      eyebrow: "Call booked",
      tone: "success",
      title: "What to expect on your onboarding call",
      body: [
        formDoneOf(client)
          ? "Thanks for filling out your onboarding form and booking your onboarding call. Here's what happens next."
          : "Thanks for booking your onboarding call. Here's what happens next.",
        "On your onboarding call, one of our marketing specialists will:",
      ],
      list: { title: "On the call", items: ON_THE_CALL },
      closing: "If you skipped something or weren't sure of an answer, don't worry. We'll sort it out together on the call.",
      signOff: ["Talk soon,", "Team BayShore"],
    });
    if (!sent) await Client.updateOne({ _id: client._id }, { $unset: { "onboardingEmails.callBookedSentAt": "" } });
  } catch (error) {
    logFailure("call booked", error);
  }
};

// ── 2. Reminders ─────────────────────────────────────────────────────────────

// When each reminder goes, in hours after the account was made (the welcome goes out then): one,
// 3 hours later. After it, no more.
export const REMINDER_HOURS = [3];
// How often the reminders due are looked for — often, so a reminder goes close to 3 hours, not up to an hour late.
const CHECK_EVERY = 5 * 60 * 1000;
// A client made longer ago than this is never reminded — so the first run doesn't write to
// everyone who signed up before these emails existed.
const REMIND_WITHIN = (REMINDER_HOURS[REMINDER_HOURS.length - 1] + 48) * HOUR;
// At least this long between two reminders, even when both are overdue.
const MIN_GAP = 24 * HOUR;

const emailReminder = (client: IClient) =>
  send(client, {
    eyebrow: "Onboarding",
    tone: "action",
    title: "Welcome to BayShore!",
    body: [
      "Your account has already been created using this email address. You can access it using the link below:",
      { label: "Access Your Account", url: LOGIN_URL },
      "We noticed that you haven't completed your onboarding process yet.",
      "Having trouble with the form? No worries! You can simply schedule a call with one of our marketing specialists. We'll walk you through everything, answer your questions, and complete the onboarding together.",
    ],
    button: { label: "Schedule Your Onboarding Call", url: BOOK_URL },
    link: { label: "Or Complete Your Onboarding Form", url: FORM_URL },
    closing: "We're excited to get started and help your business grow!",
    signOff: ["Best regards,", "Team BayShore"],
  });

// Sends the reminders that are due. Each is claimed on the record before it goes (and given back
// if it can't), so none goes twice.
export const sendDueReminders = async () => {
  const now = Date.now();
  for (const [index, hours] of REMINDER_HOURS.entries()) {
    const due = await Client.find({
      // Made their own account and are still onboarding: the team moves them on from there.
      status: "onboarding",
      user: { $exists: true },
      "onboarding.kickoffCall.booked": { $ne: true },
      createdAt: { $lte: new Date(now - hours * HOUR), $gte: new Date(now - REMIND_WITHIN) },
      "onboardingEmails.reminders": index === 0 ? { $in: [null, 0] } : index,
      ...(index > 0 ? { "onboardingEmails.lastReminderAt": { $lte: new Date(now - MIN_GAP) } } : {}),
    }).limit(100);

    for (const client of due) {
      const claimed = await Client.updateOne(
        { _id: client._id, "onboardingEmails.reminders": index === 0 ? { $in: [null, 0] } : index },
        { $set: { "onboardingEmails.reminders": index + 1, "onboardingEmails.lastReminderAt": new Date() } }
      );
      if (!claimed.modifiedCount) continue;
      const sent = await emailReminder(client);
      if (!sent) {
        await Client.updateOne(
          { _id: client._id },
          { $set: { "onboardingEmails.reminders": index, "onboardingEmails.lastReminderAt": client.onboardingEmails?.lastReminderAt ?? null } }
        );
      }
    }
  }
};

// Looks for reminders due every 5 minutes, from a minute after the server starts. The server runs as
// one process (ecosystem.config.js), so this runs once — and the claims above keep it safe if not.
export const startOnboardingReminders = () => {
  if (!emailReady) {
    console.log("Onboarding reminders off: email isn't set up (RESEND_API_KEY, EMAIL_FROM).");
    return;
  }
  const run = () => sendDueReminders().catch((error) => logFailure("reminders", error));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, CHECK_EVERY).unref();
};
