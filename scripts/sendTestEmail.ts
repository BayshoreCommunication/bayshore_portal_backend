import { emailReady, notificationEmail, sendEmail } from "../utils/email";
import { env } from "../config/env";

// Sends one sample notification email, to check the Resend setup (RESEND_API_KEY, EMAIL_FROM):
//   npm run email:test -- you@example.com
const run = async () => {
  const to = process.argv[2];
  if (!to) throw new Error("Say where to send it: npm run email:test -- you@example.com");
  if (!emailReady) throw new Error("Set RESEND_API_KEY and EMAIL_FROM in .env first.");

  const sent = await sendEmail({
    to,
    ...notificationEmail({
      name: "Test",
      title: "New content is ready for your approval",
      body: "Sample piece — this is a test email",
      url: `${env.clientPortalUrl}/content`,
    }),
  });
  if (!sent) throw new Error("Resend didn't take the email — see the line above for why.");
  console.log(`Sent a test email to ${to} from ${env.email.from}`);
};

run().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
