import mongoose, { Schema, Document } from "mongoose";

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "restore",
  "login",
  "login_failed",
  "logout",
  "token_reuse_detected",
  "password_changed",
  "role_changed",
  "status_changed",
  "approve",
  "reject",
  "publish",
  "convert",
  "export",
  "other",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface IAuditLog extends Document {
  actor?: mongoose.Types.ObjectId;
  actorName?: string;
  actorRole?: string;
  action: AuditAction;
  resource: string;
  resourceId?: mongoose.Types.ObjectId;
  client?: mongoose.Types.ObjectId;
  summary?: string;
  changes: AuditChange[];
  snapshot?: unknown;
  details?: unknown;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     AuditLog:
 *       type: object
 *       description: Append-only record of who did what, to which record, and when. Kept for 30 days, then deleted automatically.
 *       properties:
 *         _id:
 *           type: string
 *         actor:
 *           type: string
 *           description: User id of whoever did it (empty for anonymous events such as a failed login)
 *         actorName:
 *           type: string
 *           description: Name at the time of the action, kept even if the user is later deleted
 *         actorRole:
 *           type: string
 *         action:
 *           type: string
 *           enum: [create, update, delete, restore, login, login_failed, logout, token_reuse_detected, password_changed, role_changed, status_changed, approve, reject, publish, convert, export, other]
 *         resource:
 *           type: string
 *           description: Model name, for example User, Client, Report
 *           example: User
 *         resourceId:
 *           type: string
 *         client:
 *           type: string
 *           description: Client this record belongs to, so a client's whole history can be listed at once
 *         summary:
 *           type: string
 *           example: Updated User "John Doe" (designation)
 *         changes:
 *           type: array
 *           description: Only the fields that changed. Sensitive fields are masked.
 *           items:
 *             type: object
 *             properties:
 *               field:
 *                 type: string
 *               before: {}
 *               after: {}
 *         snapshot:
 *           type: object
 *           description: Full record as it was when created or deleted (sensitive fields removed)
 *         details:
 *           type: object
 *         ip:
 *           type: string
 *         userAgent:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 */
const auditLogSchema = new Schema<IAuditLog>(
  {
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    actorName: { type: String, trim: true },
    actorRole: { type: String, trim: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    resource: { type: String, required: true, trim: true },
    resourceId: { type: Schema.Types.ObjectId },
    client: { type: Schema.Types.ObjectId, ref: "Client" },
    summary: { type: String, trim: true },
    changes: {
      type: [
        new Schema(
          {
            field: { type: String, required: true },
            before: { type: Schema.Types.Mixed },
            after: { type: Schema.Types.Mixed },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    snapshot: { type: Schema.Types.Mixed },
    details: { type: Schema.Types.Mixed },
    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

// Entries are kept for 30 days at most; MongoDB deletes older ones on its own
// (its background sweep runs about once a minute). This index also serves the
// default newest-first sort.
export const AUDIT_LOG_RETENTION_DAYS = 30;
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 });
auditLogSchema.index({ client: 1, createdAt: -1 });
auditLogSchema.index({ resource: 1, resourceId: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

// Append-only: an audit trail that can be edited or deleted can't be trusted.
const appendOnly = (message: string) => () => {
  throw new Error(message);
};

auditLogSchema.pre("save", function () {
  if (!this.isNew) throw new Error("Audit logs are append-only");
});
auditLogSchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findOneAndReplace",
    "findOneAndDelete",
    "replaceOne",
    "deleteOne",
    "deleteMany",
  ],
  appendOnly("Audit logs are append-only")
);
auditLogSchema.pre("deleteOne", { document: true, query: false }, appendOnly("Audit logs are append-only"));

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
