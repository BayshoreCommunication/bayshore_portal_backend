import dotenv from "dotenv";

dotenv.config();

const port = Number(process.env.PORT) || 5000;
const deploymentHost =
  process.env.API_PUBLIC_URL ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL ||
  process.env.VERCEL_URL;
const publicUrl = deploymentHost
  ? deploymentHost.startsWith("http")
    ? deploymentHost.replace(/\/$/, "")
    : `https://${deploymentHost.replace(/\/$/, "")}`
  : `http://localhost:${port}`;

// The database address may be given as MONGO_URI or MONGO_URL.
const mongoUri = process.env.MONGO_URI || process.env.MONGO_URL;
if (!mongoUri) {
  throw new Error("Missing required environment variable: MONGO_URI (or MONGO_URL)");
}

const requiredVars = [
  "JWT_SECRET",
  "DO_SPACES_KEY",
  "DO_SPACES_SECRET",
  "DO_SPACES_ENDPOINT",
  "DO_SPACES_BUCKET",
  "DO_SPACES_REGION",
  "DO_SPACES_CDN_URL",
] as const;

for (const key of requiredVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  port,
  nodeEnv: process.env.NODE_ENV || "development",
  mongoUri,
  // The database on that server the data is in. Set here rather than left to the address, which
  // may not name one — and then MongoDB quietly uses an empty "test" database instead.
  mongoDbName: process.env.MONGO_DB_NAME || "bayshore_portal_db",
  clientUrl: process.env.CLIENT_URL || "http://localhost:3000",
  clientUrls: (process.env.CLIENT_URL || "http://localhost:3000")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),
  isProduction:
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1",
  publicUrl,
  jwtSecret: process.env.JWT_SECRET as string,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "30d",
  // Where the client portal lives — Stripe sends a client back here after paying.
  clientPortalUrl: (process.env.CLIENT_PORTAL_URL || "http://localhost:3001").replace(/\/+$/, ""),
  // Where the team's portal lives — the buttons in emails to the team lead here.
  companyPortalUrl: (process.env.COMPANY_PORTAL_URL || "http://localhost:3000").replace(/\/+$/, ""),
  // Where a client books their onboarding call: a Google Calendar appointment schedule. The
  // client portal shows the same one (client-portal: lib/booking.ts).
  bookingUrl: (
    process.env.BOOKING_URL ||
    "https://calendar.google.com/calendar/appointments/schedules/AcZssZ3xiwhgZG7-JPeXm3m_pZVueFOj54UnDfxT_JWB3ixQ5v88SIsI-coqD6knMrZzf4k38WzCDkU2"
  ).trim(),
  // Who may open Services in the company portal, and the security code each must enter:
  // "superadmin:123456,someone@bayshore.com:987654" — a role, or one person's email (theirs wins
  // over their role's). Someone with no code here can't open Services at all.
  serviceAccessCodes: new Map(
    (process.env.SERVICE_ACCESS_CODES || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.includes(":"))
      .map((entry) => {
        const at = entry.lastIndexOf(":");
        return [entry.slice(0, at).trim().toLowerCase(), entry.slice(at + 1).trim()] as const;
      })
      .filter(([who, code]) => who && code)
  ),
  // Optional at boot: without them the API runs, and checkout answers 503.
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  },
  // Optional at boot: without the key and a sender the API runs, and no email goes out.
  email: {
    resendApiKey: process.env.RESEND_API_KEY || "",
    // A sender on a domain verified in Resend: "BayShore Communication <notifications@example.com>".
    from: process.env.EMAIL_FROM || "",
    // Where a client's reply to an email goes, if not to the sender.
    replyTo: process.env.EMAIL_REPLY_TO || "",
  },
  doSpaces: {
    key: process.env.DO_SPACES_KEY as string,
    secret: process.env.DO_SPACES_SECRET as string,
    endpoint: process.env.DO_SPACES_ENDPOINT as string,
    bucket: process.env.DO_SPACES_BUCKET as string,
    region: process.env.DO_SPACES_REGION as string,
    cdnUrl: process.env.DO_SPACES_CDN_URL as string,
    folder: process.env.DO_FOLDER_NAME || "uploads",
  },
};
