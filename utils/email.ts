import { Resend } from "resend";
import { env } from "../config/env";

// Email goes out through Resend (https://resend.com). Optional at boot, like Stripe: without
// RESEND_API_KEY and EMAIL_FROM the API runs as usual and simply sends nothing.
const resend = env.email.resendApiKey ? new Resend(env.email.resendApiKey) : null;

export const emailReady = Boolean(resend && env.email.from);

// Resend is someone else's server: a slow answer mustn't hold up the request that caused it.
const SEND_TIMEOUT_MS = 10_000;

export type Email = { to: string; subject: string; html: string; text: string };

// Sends one email. Never throws — an email is a courtesy, like the notification it repeats:
// one that can't go out is logged, and whatever caused it carries on.
export const sendEmail = async ({ to, subject, html, text }: Email): Promise<boolean> => {
  if (!resend || !env.email.from) return false;

  let timer: NodeJS.Timeout | undefined;
  try {
    const { error } = await Promise.race([
      resend.emails.send({ from: env.email.from, to, subject, html, text, ...(env.email.replyTo ? { replyTo: env.email.replyTo } : {}) }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer from Resend in ${SEND_TIMEOUT_MS / 1000}s`)), SEND_TIMEOUT_MS);
      }),
    ]);
    if (error) {
      console.error(`Email to ${to} failed: ${error.message}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`Email to ${to} failed:`, (error as Error).message);
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => ESCAPES[character]);

const BRAND = "BayShore Communication";

// What kind of news an email carries — the colour of the small label over its title.
export type EmailTone = "action" | "success" | "info" | "alert";
const TONES: Record<EmailTone, { text: string; background: string }> = {
  action: { text: "#1d4ed8", background: "#e8effd" },
  success: { text: "#15803d", background: "#e7f6ec" },
  info: { text: "#475569", background: "#eef1f5" },
  alert: { text: "#b45309", background: "#fef3c7" },
};

// Who an email is for: a client (it speaks of their portal) or the BayShore team.
export type EmailAudience = "client" | "team";

export type ActivityEmail = {
  // Who it goes to — only their first name is used.
  name: string;
  // What happened, as the subject and the headline.
  title: string;
  // A word or two over the headline: "Content", "Monthly report"…
  eyebrow?: string;
  tone?: EmailTone;
  // A line or two about it.
  body?: string;
  // Facts about it, one per row: "Company — Carter Injury Law".
  details?: [label: string, value: string | undefined][];
  // The button, and where it leads. Without one, the email is only news.
  button?: { label: string; url: string };
  audience?: EmailAudience;
};

// Every email the portals send, in one look: a dark band with the name, a gold rule, a small
// coloured label, the headline, a line about it, the facts in a box, one button — and why it
// was sent. Tables and inline styles only, the way email clients need them.
export const activityEmail = ({ name, title, eyebrow, tone = "action", body, details = [], button, audience = "client" }: ActivityEmail): Omit<Email, "to"> => {
  const firstName = name.trim().split(/\s+/)[0] || "there";
  const rows = details.filter((row): row is [string, string] => Boolean(row[1]?.trim()));
  const colors = TONES[tone];
  const portal = audience === "client" ? "client portal" : "BayShore team portal";
  const why =
    audience === "client"
      ? `You're getting this because you have a ${BRAND} client account.`
      : `You're getting this because you work on this account at ${BRAND}.`;

  const text = [
    `Hi ${firstName},`,
    "",
    title,
    ...(body ? ["", body] : []),
    ...(rows.length ? ["", ...rows.map(([label, value]) => `${label}: ${value}`)] : []),
    ...(button ? ["", `${button.label}: ${button.url}`] : []),
    "",
    `— ${BRAND}`,
    "",
    why,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef1f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2530;-webkit-font-smoothing:antialiased;">
    <!-- The line inboxes show beside the subject. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(body ?? title)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:36px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,0.06);">
            <tr>
              <td style="background:#0b1522;padding:22px 30px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:17px;font-weight:700;letter-spacing:0.2px;color:#ffffff;">BayShore <span style="font-weight:400;color:#c9d2dc;">Communication</span></td>
                    <td align="right" style="font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;color:#e7c780;">${audience === "client" ? "Client portal" : "Team update"}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="height:3px;line-height:3px;font-size:0;background:#e7c780;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:32px 30px 10px;">
                ${eyebrow ? `<span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${colors.background};color:${colors.text};font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">${escapeHtml(eyebrow)}</span>` : ""}
                <p style="margin:${eyebrow ? "16px" : "0"} 0 0;font-size:14px;line-height:1.6;color:#6b7280;">Hi ${escapeHtml(firstName)},</p>
                <h1 style="margin:6px 0 0;font-size:22px;line-height:1.35;font-weight:700;color:#0b1522;">${escapeHtml(title)}</h1>
                ${body ? `<p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">${escapeHtml(body)}</p>` : ""}
              </td>
            </tr>
            ${
              rows.length
                ? `<tr>
              <td style="padding:14px 30px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;border:1px solid #eceef2;border-radius:12px;">
                  ${rows
                    .map(
                      ([label, value], index) => `<tr>
                    <td style="padding:11px 16px;${index ? "border-top:1px solid #eceef2;" : ""}font-size:12.5px;color:#6b7280;width:38%;vertical-align:top;">${escapeHtml(label)}</td>
                    <td style="padding:11px 16px;${index ? "border-top:1px solid #eceef2;" : ""}font-size:13.5px;font-weight:600;color:#0b1522;vertical-align:top;">${escapeHtml(value)}</td>
                  </tr>`
                    )
                    .join("")}
                </table>
              </td>
            </tr>`
                : ""
            }
            ${
              button
                ? `<tr>
              <td style="padding:26px 30px 6px;">
                <a href="${escapeHtml(button.url)}" style="display:inline-block;background:#0b1522;color:#ffffff;text-decoration:none;font-size:14.5px;font-weight:600;padding:13px 24px;border-radius:10px;">${escapeHtml(button.label)} &rarr;</a>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 30px 0;font-size:12px;line-height:1.6;color:#9ca3af;">Button not working? Open this link:<br /><a href="${escapeHtml(button.url)}" style="color:#2f5fd8;word-break:break-all;">${escapeHtml(button.url)}</a></td>
            </tr>`
                : ""
            }
            <tr>
              <td style="padding:28px 30px 30px;">
                <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">Thank you,<br /><strong style="color:#0b1522;">The ${BRAND} team</strong></p>
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
            <tr>
              <td align="center" style="padding:18px 20px 0;font-size:11.5px;line-height:1.7;color:#9ca3af;">
                ${escapeHtml(why)} You can see everything in your ${portal}.<br />&copy; ${new Date().getFullYear()} ${BRAND}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: title, text, html };
};

// A portal notification as an email: what happened, about what, and a button that opens it
// in the portal. `name` is who it goes to; `url` where the button leads.
export const notificationEmail = ({ name, title, body, url, ...rest }: { name: string; title: string; body?: string; url: string } & Partial<ActivityEmail>): Omit<Email, "to"> =>
  activityEmail({ name, title, body, button: { label: rest.audience === "team" ? "Open in the portal" : "Open in your portal", url }, ...rest });
