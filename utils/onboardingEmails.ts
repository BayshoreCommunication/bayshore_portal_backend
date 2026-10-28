import { env } from "../config/env";
import { Client, type IClient } from "../models/client.model";
import { activityEmail, emailReady, sendEmail, type ActivityEmail } from "./email";

// The emails that walk a new client through onboarding:
//   1. Welcome — when their portal account is made: how to sign in, and the two things to do
//      first: fill in the onboarding form and book the onboarding call.
//   2. Reminders — while the call isn't booked: the form can wait; book the call, and a
//      marketing specialist fills it in with them on it (see startOnboardingReminders).
//   3. Call booked — once they say they've booked it ("I've booked my call"): what the call is for.
// Each goes once; what has gone out is kept on the client (client.onboardingEmails). Like every
// email here, none of them ever throws: a failure is logged, and whatever caused it carries on.

const HOUR = 60 * 60 * 1000;

// A page of the client portal, through signing in: whoever isn't signed in logs in first, and
// lands on it after.
const portalPage = (path: string) => `${env.clientPortalUrl}/sign-in?callbackUrl=${encodeURIComponent(path)}`;
const FORM_URL = portalPage("/onboarding");
// The onboarding page with its "Book your onboarding call" card open (client-portal: KickoffCallCard).
const BOOK_URL = portalPage("/onboarding?book=1");

const ON_THE_CALL = [
  "A marketing specialist goes through your answers with you.",
  "Anything still missing, you fill in together, so there's no need to finish the form first.",
  "We collect what we need to get started, like logins, your logo and photos.",
  "Together you plan your next steps.",
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

    const sent = await send(client, {
      eyebrow: "Call booked",
      tone: "success",
      title: "Your onboarding call is booked",
      body: "Thank you for booking. The date, time and meeting link are in the calendar invite from Google Calendar in your inbox. Need a different time? You can reschedule from that invite.",
      list: { title: "What happens on the call", items: ON_THE_CALL },
      details: [["Company", client.companyName]],
      button: { label: "Open your portal", url: FORM_URL },
    });
    if (!sent) await Client.updateOne({ _id: client._id }, { $unset: { "onboardingEmails.callBookedSentAt": "" } });
  } catch (error) {
    logFailure("call booked", error);
  }
};

// ── 2. Reminders ─────────────────────────────────────────────────────────────

// When each reminder goes, in hours after the account was made: a day later, then three days
// later. After the last one, no more.
export const REMINDER_HOURS = [24, 72];
// How often the reminders due are looked for.
const CHECK_EVERY = HOUR;
// A client made longer ago than this is never reminded — so the first run doesn't write to
// everyone who signed up before these emails existed.
const REMIND_WITHIN = (REMINDER_HOURS[REMINDER_HOURS.length - 1] + 48) * HOUR;
// At least this long between two reminders, even when both are overdue.
const MIN_GAP = 24 * HOUR;

const emailReminder = (client: IClient, number: number) => {
  const formDone = formDoneOf(client);
  return send(client, {
    eyebrow: "Onboarding",
    tone: "action",
    title: number === 1 ? "Book your onboarding call. The form can wait." : "A quick reminder about your onboarding call",
    body: formDone
      ? "Thank you for filling in your onboarding form. The last step is your onboarding call: pick a time that suits you."
      : "You haven't booked your onboarding call yet. There's no need to finish the form first: book a time, and a marketing specialist will go through it with you on the call and fill in the rest.",
    list: { title: "On the call", items: ON_THE_CALL },
    button: { label: "Book your onboarding call", url: BOOK_URL },
    link: formDone ? undefined : { label: "Or carry on with your form", url: FORM_URL },
  });
};

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
      const sent = await emailReminder(client, index + 1);
      if (!sent) {
        await Client.updateOne(
          { _id: client._id },
          { $set: { "onboardingEmails.reminders": index, "onboardingEmails.lastReminderAt": client.onboardingEmails?.lastReminderAt ?? null } }
        );
      }
    }
  }
};

// Looks for reminders due every hour, from a minute after the server starts. The server runs as
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
