import mongoose, { Schema, Document } from "mongoose";
import { auditPlugin } from "../plugins/auditPlugin";
import { getRequestContext } from "../utils/requestContext";

// A larger piece of work for a client — a website redesign, a campaign launch.
// Either side can open one: the client from their portal, or the team on the
// client's behalf (a request made by phone or in a meeting).

export const PROJECT_PRIORITIES = ["low", "normal", "high"] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

// new (asked for, not started) → in_progress → completed. Only the team moves a
// project along; the client sees the status but can't change it.
export const PROJECT_STATUSES = ["new", "in_progress", "completed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// Who opened the project — same split as content comments and lead history.
export const PROJECT_REQUESTERS = ["client", "team"] as const;
export type ProjectRequester = (typeof PROJECT_REQUESTERS)[number];

export const PROJECT_NAME_MAX_LENGTH = 120;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 2000;

// ── Attached files ───────────────────────────────────────────────────────────

export const PROJECT_MAX_FILES = 10;
export const PROJECT_MAX_FILE_SIZE = 25 * 1024 * 1024;

// Briefs, spreadsheets, artwork, short clips, archives. Not "anything": the files
// are served publicly from Spaces, so pages and scripts (HTML, SVG, JS) and
// programs are left out.
export const PROJECT_FILE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/rtf",
  "text/rtf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

export interface IProjectFile {
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface IProject extends Document {
  client: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  targetDate?: Date;
  priority: ProjectPriority;
  status: ProjectStatus;
  files: IProjectFile[];

  requestedBy: ProjectRequester;
  createdBy?: mongoose.Types.ObjectId;
  // Stamped as the status moves; cleared again if it moves back.
  startedAt?: Date;
  completedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     ProjectFile:
 *       type: object
 *       properties:
 *         url: { type: string, description: DigitalOcean Spaces URL }
 *         name: { type: string, example: site-brief.pdf }
 *         size: { type: number, description: Bytes }
 *         mimeType: { type: string, example: application/pdf }
 *     Project:
 *       type: object
 *       description: A larger piece of work for a client. Opened by the client from their portal or by the team on their behalf.
 *       properties:
 *         _id: { type: string }
 *         client: { type: string, description: Client this project belongs to }
 *         name: { type: string, maxLength: 120, example: Website Redesign }
 *         description: { type: string, maxLength: 2000 }
 *         targetDate: { type: string, format: date-time }
 *         priority: { type: string, enum: [low, normal, high] }
 *         status: { type: string, enum: [new, in_progress, completed], description: Only the team changes it }
 *         files:
 *           type: array
 *           maxItems: 10
 *           items:
 *             $ref: '#/components/schemas/ProjectFile'
 *         requestedBy: { type: string, enum: [client, team], description: Who opened the project }
 *         createdBy: { type: string }
 *         startedAt: { type: string, format: date-time }
 *         completedAt: { type: string, format: date-time }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 */

const projectFileSchema = new Schema<IProjectFile>(
  {
    url: { type: String, required: [true, "File URL is required"], trim: true },
    name: { type: String, trim: true, default: "" },
    size: { type: Number, default: 0 },
    mimeType: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const projectSchema = new Schema<IProject>(
  {
    client: { type: Schema.Types.ObjectId, ref: "Client", required: [true, "Client is required"], index: true },
    name: {
      type: String,
      required: [true, "Project name is required"],
      trim: true,
      maxlength: [PROJECT_NAME_MAX_LENGTH, `Project name cannot exceed ${PROJECT_NAME_MAX_LENGTH} characters`],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [PROJECT_DESCRIPTION_MAX_LENGTH, `Description cannot exceed ${PROJECT_DESCRIPTION_MAX_LENGTH} characters`],
    },
    targetDate: { type: Date },
    priority: { type: String, enum: PROJECT_PRIORITIES, default: "normal" },
    status: { type: String, enum: PROJECT_STATUSES, default: "new" },
    files: {
      type: [projectFileSchema],
      default: [],
      validate: {
        validator: (files: IProjectFile[]) => files.length <= PROJECT_MAX_FILES,
        message: `A project can have at most ${PROJECT_MAX_FILES} files`,
      },
    },

    requestedBy: { type: String, enum: PROJECT_REQUESTERS },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

// One client's list, newest first — the default view in both portals.
projectSchema.index({ client: 1, createdAt: -1 });
// One client's list filtered by status, and the status tiles.
projectSchema.index({ client: 1, status: 1, createdAt: -1 });
// Company-wide list across all clients.
projectSchema.index({ createdAt: -1 });
projectSchema.index({ status: 1, createdAt: -1 });

// Who opened it is taken from the signed-in user, and moving through the steps
// stamps when each happened.
projectSchema.pre("save", function () {
  const actor = getRequestContext()?.actor;

  if (this.isNew) {
    if (actor && !this.createdBy) this.createdBy = new mongoose.Types.ObjectId(actor.id);
    if (!this.requestedBy) this.requestedBy = actor?.role === "client" ? "client" : "team";
  }

  if (!this.isNew && !this.isModified("status")) return;

  if (this.status === "new") {
    this.startedAt = undefined;
    this.completedAt = undefined;
    return;
  }
  if (!this.startedAt) this.startedAt = new Date();
  if (this.status === "completed") {
    if (!this.completedAt) this.completedAt = new Date();
  } else {
    this.completedAt = undefined;
  }
});

projectSchema.plugin(auditPlugin, {
  resource: "Project",
  clientField: "client",
  actionByField: { status: "status_changed" },
});

export const Project = mongoose.model<IProject>("Project", projectSchema);
