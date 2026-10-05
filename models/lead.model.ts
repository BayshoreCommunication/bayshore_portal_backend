import mongoose, { Schema, Document } from "mongoose";
import { auditPlugin } from "../plugins/auditPlugin";
import { getRequestContext } from "../utils/requestContext";
import { normalizePhone } from "../utils/phone";
import { EMAIL_REGEX, PHONE_REGEX } from "./user.model";

// ── Where a lead came from ───────────────────────────────────────────────────

// The channel each source rolls up into — what the "Where Leads Come From" chart
// groups by. Mirrors component/leads/data.ts in both portals — keep them in step.
export const LEAD_CHANNELS = ["gmb", "website", "social", "referral", "direct"] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export const LEAD_SOURCE_CHANNELS = {
  gmb_call: "gmb",
  gmb_message: "gmb",
  website_form: "website",
  website_chat: "website",
  blog_cta: "website",
  facebook: "social",
  instagram: "social",
  referral: "referral",
  walk_in: "direct",
  office_call: "direct",
  other: "direct",
} as const satisfies Record<string, LeadChannel>;

export const LEAD_SOURCES = Object.keys(LEAD_SOURCE_CHANNELS) as (keyof typeof LEAD_SOURCE_CHANNELS)[];
export type LeadSource = (typeof LEAD_SOURCES)[number];

// How the record got here: typed in by someone, brought in from a spreadsheet,
// or pushed by a tracked channel (call tracking, a website form hook).
export const LEAD_ORIGINS = ["manual", "import", "integration"] as const;
export type LeadOrigin = (typeof LEAD_ORIGINS)[number];

// Case types are typed in, not picked from a list — every firm practises different
// areas of law. The lists group by the exact text, so the forms suggest what a
// client already uses to keep it consistent.

// ── Where a lead is in the pipeline ──────────────────────────────────────────

// new → contacted → qualified → consultation_set → converted. Only the team moves a
// lead along (company portal); the client portal reads leads but never changes them.
// lost closes a lead that went nowhere (unreachable, not a fit, hired someone else)
// so it stops counting as open.
export const LEAD_STATUSES = ["new", "contacted", "qualified", "consultation_set", "converted", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

// Who made a change — same split as content comments. Today only "team" writes,
// but the history keeps the split in case clients ever update their own leads.
export const LEAD_ACTOR_KINDS = ["client", "team"] as const;
export type LeadActorKind = (typeof LEAD_ACTOR_KINDS)[number];

export const LEAD_NAME_MAX_LENGTH = 120;
export const LEAD_NOTES_MAX_LENGTH = 500;
export const LEAD_LOST_REASON_MAX_LENGTH = 300;
export const LEAD_CASE_TYPE_MAX_LENGTH = 100;

export interface ILeadStatusChange {
  status: LeadStatus;
  at: Date;
  by?: mongoose.Types.ObjectId;
  byKind?: LeadActorKind;
}

export interface ILead extends Document {
  client: mongoose.Types.ObjectId;

  fullName: string;
  phone?: string;
  email?: string;

  caseType: string;

  source: LeadSource;
  // Derived from source on save; stored so the channel chart can group by it.
  channel: LeadChannel;
  origin: LeadOrigin;
  // The id the tracked channel gave this lead, so a re-sent hook doesn't duplicate it.
  externalId?: string;

  receivedAt: Date;

  status: LeadStatus;
  statusHistory: ILeadStatusChange[];
  consultationAt?: Date;
  convertedAt?: Date;
  lostReason?: string;

  // Shown in both portals — intake details the firm needs before calling back.
  notes?: string;
  // Team-only. Hidden from every query unless asked for with select("+internalNotes");
  // never select it for a client-portal request.
  internalNotes?: string;

  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     Lead:
 *       type: object
 *       description: An inquiry captured for a client. Read by both portals; internalNotes is team-only.
 *       properties:
 *         _id: { type: string }
 *         client: { type: string, description: Client this lead belongs to }
 *         fullName: { type: string, example: Maria Alvarez }
 *         phone: { type: string, example: "+19876543210" }
 *         email: { type: string, example: maria@example.com }
 *         caseType: { type: string, maxLength: 100, example: Car Accident, description: Typed in; each firm uses its own }
 *         source:
 *           type: string
 *           enum: [gmb_call, gmb_message, website_form, website_chat, blog_cta, facebook, instagram, referral, walk_in, office_call, other]
 *         channel:
 *           type: string
 *           enum: [gmb, website, social, referral, direct]
 *           description: Worked out from source; read-only
 *         origin: { type: string, enum: [manual, import, integration] }
 *         receivedAt: { type: string, format: date-time }
 *         status:
 *           type: string
 *           enum: [new, contacted, qualified, consultation_set, converted, lost]
 *         statusHistory:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               status: { type: string }
 *               at: { type: string, format: date-time }
 *               by: { type: string }
 *               byKind: { type: string, enum: [client, team] }
 *         consultationAt: { type: string, format: date-time }
 *         convertedAt: { type: string, format: date-time }
 *         lostReason: { type: string }
 *         notes: { type: string, maxLength: 500, description: Visible in both portals }
 *         internalNotes: { type: string, maxLength: 500, description: Team-only. Never returned to the client portal. }
 *         createdBy: { type: string }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 */

const statusChangeSchema = new Schema<ILeadStatusChange>(
  {
    status: { type: String, enum: LEAD_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byKind: { type: String, enum: LEAD_ACTOR_KINDS },
  },
  { _id: false }
);

const leadSchema = new Schema<ILead>(
  {
    client: { type: Schema.Types.ObjectId, ref: "Client", required: [true, "Client is required"], index: true },

    fullName: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [LEAD_NAME_MAX_LENGTH, `Name cannot exceed ${LEAD_NAME_MAX_LENGTH} characters`],
    },
    phone: { type: String, trim: true, match: [PHONE_REGEX, "Please enter a valid phone number"] },
    email: { type: String, trim: true, lowercase: true, match: [EMAIL_REGEX, "Please enter a valid email address"] },

    caseType: {
      type: String,
      required: [true, "Case type is required"],
      trim: true,
      maxlength: [LEAD_CASE_TYPE_MAX_LENGTH, `Case type cannot exceed ${LEAD_CASE_TYPE_MAX_LENGTH} characters`],
    },

    source: {
      type: String,
      enum: { values: LEAD_SOURCES, message: "Pick a source from the list" },
      required: [true, "Source is required"],
    },
    channel: { type: String, enum: LEAD_CHANNELS },
    origin: { type: String, enum: LEAD_ORIGINS, default: "manual" },
    externalId: { type: String, trim: true },

    receivedAt: { type: Date, required: [true, "Received date is required"], default: Date.now },

    status: { type: String, enum: LEAD_STATUSES, default: "new" },
    statusHistory: { type: [statusChangeSchema], default: [] },
    consultationAt: { type: Date },
    convertedAt: { type: Date },
    lostReason: {
      type: String,
      trim: true,
      maxlength: [LEAD_LOST_REASON_MAX_LENGTH, `Reason cannot exceed ${LEAD_LOST_REASON_MAX_LENGTH} characters`],
    },

    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: [LEAD_NOTES_MAX_LENGTH, `Notes cannot exceed ${LEAD_NOTES_MAX_LENGTH} characters`],
    },
    internalNotes: {
      type: String,
      trim: true,
      default: "",
      select: false,
      maxlength: [LEAD_NOTES_MAX_LENGTH, `Internal notes cannot exceed ${LEAD_NOTES_MAX_LENGTH} characters`],
    },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// One client's list, newest first — the default view in both portals.
leadSchema.index({ client: 1, receivedAt: -1 });
// One client's list filtered by status, and the month's stat tiles.
leadSchema.index({ client: 1, status: 1, receivedAt: -1 });
// The "Where Leads Come From" chart.
leadSchema.index({ client: 1, channel: 1, receivedAt: -1 });
// Company-wide list across all clients.
leadSchema.index({ receivedAt: -1 });
leadSchema.index({ status: 1, receivedAt: -1 });
// A tracked channel can re-send the same lead; it must land once per client.
leadSchema.index(
  { client: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: "string" } } }
);

leadSchema.pre("validate", function () {
  if (this.phone) this.phone = normalizePhone(this.phone) as string;

  this.channel = LEAD_SOURCE_CHANNELS[this.source];

  if (!this.phone && !this.email) this.invalidate("phone", "Add a phone number or an email address");

  if (this.status === "lost" && !this.lostReason?.trim()) this.invalidate("lostReason", "Say why the lead was lost");
  if (this.status !== "lost") this.lostReason = undefined;
  if (this.status === "consultation_set" && !this.consultationAt) {
    this.invalidate("consultationAt", "Pick the consultation date");
  }

  if (this.receivedAt && this.receivedAt.getTime() > Date.now() + 60_000) {
    this.invalidate("receivedAt", "Received date can't be in the future");
  }
});

// Every status change is written to the history with who made it, so both portals
// can show a lead's timeline and the stats can count by when a step happened.
leadSchema.pre("save", function () {
  const actor = getRequestContext()?.actor;
  const actorId = actor ? new mongoose.Types.ObjectId(actor.id) : undefined;

  if (this.isNew && actorId && !this.createdBy) this.createdBy = actorId;
  if (!this.isNew && !this.isModified("status")) return;

  this.statusHistory.push({
    status: this.status,
    at: new Date(),
    by: actorId,
    byKind: actor ? (actor.role === "client" ? "client" : "team") : undefined,
  });

  if (this.status === "converted") {
    if (!this.convertedAt) this.convertedAt = new Date();
  } else {
    this.convertedAt = undefined;
  }
});

leadSchema.plugin(auditPlugin, {
  resource: "Lead",
  clientField: "client",
  actionByField: { status: "status_changed" },
});

export const Lead = mongoose.model<ILead>("Lead", leadSchema);
