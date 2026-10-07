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

// A portal notification as an email: what happened, about what, and a button that opens it
// in the portal. `name` is who it goes to; `url` where the button leads.
export const notificationEmail = ({ name, title, body, url }: { name: string; title: string; body?: string; url: string }): Omit<Email, "to"> => {
  const firstName = name.trim().split(/\s+/)[0] || "there";
  return {
    subject: title,
    text: [`Hi ${firstName},`, "", title, ...(body ? [body] : []), "", `Open it in your portal: ${url}`, "", `— ${BRAND}`].join("\n"),
    html: `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2530;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e8eb;border-radius:14px;">
            <tr>
              <td style="padding:22px 28px;border-bottom:1px solid #eef0f2;font-size:14px;font-weight:700;color:#0b0c24;">${BRAND}</td>
            </tr>
            <tr>
              <td style="padding:26px 28px 28px;">
                <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4b5563;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0;font-size:18px;line-height:1.4;font-weight:700;color:#0b0c24;">${escapeHtml(title)}</p>
                ${body ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#374151;">${escapeHtml(body)}</p>` : ""}
                <p style="margin:24px 0 0;">
                  <a href="${escapeHtml(url)}" style="display:inline-block;background:#2f5fd8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:9px;">Open in your portal</a>
                </p>
                <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#6b7280;">If the button doesn't work, copy this link into your browser:<br /><a href="${escapeHtml(url)}" style="color:#2f5fd8;word-break:break-all;">${escapeHtml(url)}</a></p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11.5px;line-height:1.6;color:#9ca3af;">You're getting this because you have a ${BRAND} client portal account.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
};
