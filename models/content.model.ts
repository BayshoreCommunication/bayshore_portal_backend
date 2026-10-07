import mongoose, { Schema, Document } from "mongoose";
import { auditPlugin } from "../plugins/auditPlugin";
import { getRequestContext } from "../utils/requestContext";

// ── What can be prepared for a client ────────────────────────────────────────

// Every kind of piece the team prepares. Mirrors company-portal's
// component/content/contentKinds.ts — keep the two in step.
export const CONTENT_TYPES = ["image", "carousel", "story", "video", "blog", "website", "email", "gmb", "ad"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

// What an uploaded file is, worked out from its mime type.
export const CONTENT_MEDIA = ["image", "video", "doc"] as const;
export type ContentMedia = (typeof CONTENT_MEDIA)[number];

export const MEDIA_MIME_TYPES: Record<ContentMedia, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  video: ["video/mp4", "video/quicktime", "video/webm"],
  doc: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.oasis.opendocument.text",
    "application/rtf",
    "text/rtf",
    "text/plain",
  ],
};

export const MEDIA_MAX_FILE_SIZE: Record<ContentMedia, number> = {
  image: 10 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  doc: 20 * 1024 * 1024,
};

export const mediaOfMimeType = (mimeType: string): ContentMedia | undefined =>
  CONTENT_MEDIA.find((media) => MEDIA_MIME_TYPES[media].includes(mimeType));

export const CONTENT_MAX_FILES = 10;

export const CONTENT_CTAS = ["Learn more", "Call now", "Book", "Get offer", "Sign up", "Contact us"] as const;

// Fields a kind can't do without, on top of the title and its files.
export type ContentRequiredField = "pageName" | "subject" | "headline";

// Per kind: which files it takes, how many, whether a pasted link can stand in
// for an upload, and which extra fields it needs.
export const CONTENT_KIND_RULES: Record<
  ContentType,
  { media: ContentMedia[]; minFiles: number; allowLink: boolean; required: ContentRequiredField[] }
> = {
  image: { media: ["image"], minFiles: 1, allowLink: false, required: [] },
  carousel: { media: ["image"], minFiles: 2, allowLink: false, required: [] },
  story: { media: ["image", "video"], minFiles: 1, allowLink: false, required: [] },
  video: { media: ["video"], minFiles: 1, allowLink: true, required: [] },
  blog: { media: ["doc"], minFiles: 1, allowLink: true, required: [] },
  website: { media: ["doc"], minFiles: 1, allowLink: true, required: ["pageName"] },
  email: { media: ["doc", "image"], minFiles: 1, allowLink: true, required: ["subject"] },
  gmb: { media: ["image"], minFiles: 1, allowLink: false, required: [] },
  ad: { media: ["image", "video"], minFiles: 1, allowLink: false, required: ["headline"] },
};

// How each kind and field is named in error messages.
const KIND_LABELS: Record<ContentType, string> = {
  image: "image post",
  carousel: "carousel",
  story: "story",
  video: "video",
  blog: "blog article",
  website: "website content piece",
  email: "email newsletter",
  gmb: "Google Business post",
  ad: "ad creative",
};
const FIELD_LABELS: Record<ContentRequiredField, string> = { pageName: "Page name", subject: "Subject line", headline: "Headline" };
const withArticle = (label: string) => `${/^[aeiou]/i.test(label) ? "An" : "A"} ${label}`;

// ── Which batch a piece belongs to ───────────────────────────────────────────

// monthly: the regular batch for batchMonth. weekly: one week of it (weekStart).
// event: a campaign or local event (eventName + eventDate). individual: a one-off
// piece sent outside the batch (sentReason). Every piece still carries batchMonth.
export const CONTENT_BATCH_TYPES = ["monthly", "weekly", "event", "individual"] as const;
export type ContentBatchType = (typeof CONTENT_BATCH_TYPES)[number];

// draft (being prepared by the account manager) → pending_approval (sent to the
// client) → approved, or revision_requested if the client asks for a change
// (which the account manager addresses and sends back to pending_approval). The
// client can also reopen an approved piece by asking for a revision.
export const CONTENT_STATUSES = ["draft", "pending_approval", "revision_requested", "approved"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

// A new piece is either saved as a draft or sent straight to the client.
export const CONTENT_CREATE_STATUSES = ["draft", "pending_approval"] as const;

export const CONTENT_COMMENT_AUTHORS = ["client", "team"] as const;
export type ContentCommentAuthor = (typeof CONTENT_COMMENT_AUTHORS)[number];

export const CONTENT_TITLE_MAX_LENGTH = 200;
export const CONTENT_CAPTION_MAX_LENGTH = 2000;
export const CONTENT_COMMENT_MAX_LENGTH = 1000;
// Images, videos or documents attached to one comment.
export const CONTENT_COMMENT_MAX_ATTACHMENTS = 5;
// The team's note when a revised piece goes back to the client.
export const CONTENT_REVISION_NOTE_MAX_LENGTH = 1000;
export const CONTENT_SENT_REASON_MAX_LENGTH = 300;
export const CONTENT_EVENT_NAME_MAX_LENGTH = 150;
export const CONTENT_SUBJECT_MAX_LENGTH = 200;
export const CONTENT_HEADLINE_MAX_LENGTH = 150;
export const CONTENT_URL_MAX_LENGTH = 2000;

export interface IContentFile {
  url: string;
  name: string;
  size: number;
  mimeType: string;
  media: ContentMedia;
  // When it was added to the piece — the same moment for files added in one save, which is
  // how the portals tell the newest version from what the piece had before. Missing on files
  // from before this was kept, and on comment attachments.
  uploadedAt?: Date;
}

export interface IContentComment {
  author: ContentCommentAuthor;
  user?: mongoose.Types.ObjectId;
  name?: string;
  // May be empty when the comment is only attachments.
  text: string;
  attachments?: IContentFile[];
  // On a client's request for changes: the revision round it belongs to (1, 2, …). The first
  // comment with a number is the one that opened that round.
  revision?: number;
  createdAt: Date;
}

// A file the piece used to have: replaced while answering a revision, and kept so the client
// can still see what it looked like before.
export interface IContentPreviousFile extends IContentFile {
  replacedAt: Date;
  // The revision it was replaced in.
  revision?: number;
}

// One thing said during a revision — the client asking for something, or the team answering:
// their words, and any files they sent.
export interface IContentRevisionRequest {
  text: string;
  attachments?: IContentFile[];
  user?: mongoose.Types.ObjectId;
  name?: string;
  createdAt: Date;
}

// One round of changes on a piece: what the client asked for, and BayShore's answer. A piece
// — a reel, a post, an image, a video — can go through any number of these.
export interface IContentRevision {
  // 1, 2, … in the order they were asked for.
  number: number;
  // Everything the client asked for in this round, in order. Empty when a manager opened the
  // round on the client's behalf.
  requests: IContentRevisionRequest[];
  requestedAt: Date;
  requestedBy?: mongoose.Types.ObjectId;
  requestedByName?: string;
  // The team's feedback on it, in order: what they changed, with any files — before or as
  // they send the piece back.
  responses: IContentRevisionRequest[];
  // Filled in when the team sends the revised piece back for approval — with their note,
  // if they left one.
  submittedAt?: Date;
  submittedBy?: mongoose.Types.ObjectId;
  submittedByName?: string;
  note?: string;
}

export interface IContent extends Document {
  client: mongoose.Types.ObjectId;
  type: ContentType;
  title: string;

  // Pieces saved together on the Add Content page share one group, and are listed and
  // opened as a single item. A piece saved on its own — and every older piece — has none.
  group?: mongoose.Types.ObjectId;

  // e.g. "September 2026" — set for every batch type.
  batchMonth: string;
  batchType: ContentBatchType;
  weekStart?: Date;
  eventName?: string;
  eventDate?: Date;
  sentReason?: string;
  // Kept in step with batchType === "individual", for older readers.
  isIndividual: boolean;

  status: ContentStatus;
  // How many times this piece has been sent back for a revision — the length of `revisions`,
  // kept beside it so lists can show it without loading them.
  revisionCount: number;
  // Every revision this piece has been through, oldest first.
  revisions: IContentRevision[];

  // Up to CONTENT_MAX_FILES uploads (DigitalOcean Spaces), and/or a pasted link
  // for the kinds that allow one (video, blog, website, email).
  files: IContentFile[];
  link?: string;
  // Files replaced during a revision, newest first. `files` is always the piece as it stands.
  previousFiles: IContentPreviousFile[];

  // Kind-specific details.
  pageName?: string; // website
  pageUrl?: string; // website
  subject?: string; // email
  headline?: string; // ad
  cta?: string; // gmb, ad

  caption?: string;
  tags: string[];

  // Single-URL fields from before `files` existed. Still filled in from `files`
  // and `link` on save, so the client portal (which reads them) keeps working.
  imageUrl?: string;
  imageAlt?: string;
  videoUrl?: string;
  docName?: string;
  docTitle?: string;
  docUrl?: string;

  comments: IContentComment[];

  createdBy?: mongoose.Types.ObjectId;
  submittedAt?: Date;
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     ContentFile:
 *       type: object
 *       properties:
 *         url: { type: string, description: DigitalOcean Spaces URL }
 *         name: { type: string, example: services-page-v2.docx }
 *         size: { type: number, description: Bytes }
 *         mimeType: { type: string, example: image/png }
 *         media: { type: string, enum: [image, video, doc] }
 *         uploadedAt: { type: string, format: date-time, description: When it was added to the piece — the same for files added in one save. Missing on older files and on comment attachments }
 */

const contentFileSchema = new Schema<IContentFile>(
  {
    url: { type: String, required: [true, "File URL is required"], trim: true },
    name: { type: String, trim: true, default: "" },
    size: { type: Number, default: 0 },
    mimeType: { type: String, trim: true, default: "" },
    media: { type: String, enum: CONTENT_MEDIA, required: [true, "File media is required"] },
    uploadedAt: { type: Date },
  },
  { _id: false }
);

const contentCommentSchema = new Schema<IContentComment>(
  {
    author: { type: String, enum: CONTENT_COMMENT_AUTHORS, required: [true, "Comment author is required"] },
    user: { type: Schema.Types.ObjectId, ref: "User" },
    name: { type: String, trim: true },
    text: {
      type: String,
      trim: true,
      default: "",
      maxlength: [CONTENT_COMMENT_MAX_LENGTH, `Comment cannot exceed ${CONTENT_COMMENT_MAX_LENGTH} characters`],
    },
    attachments: {
      type: [contentFileSchema],
      default: [],
      validate: {
        validator: (files: IContentFile[]) => files.length <= CONTENT_COMMENT_MAX_ATTACHMENTS,
        message: `A comment can have at most ${CONTENT_COMMENT_MAX_ATTACHMENTS} attachments`,
      },
    },
    revision: { type: Number },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const contentPreviousFileSchema = new Schema<IContentPreviousFile>(
  {
    url: { type: String, required: [true, "File URL is required"], trim: true },
    name: { type: String, trim: true, default: "" },
    size: { type: Number, default: 0 },
    mimeType: { type: String, trim: true, default: "" },
    media: { type: String, enum: CONTENT_MEDIA, required: [true, "File media is required"] },
    replacedAt: { type: Date, default: Date.now },
    revision: { type: Number },
  },
  { _id: false }
);

const contentRevisionRequestSchema = new Schema<IContentRevisionRequest>(
  {
    text: { type: String, trim: true, default: "" },
    attachments: { type: [contentFileSchema], default: [] },
    user: { type: Schema.Types.ObjectId, ref: "User" },
    name: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const contentRevisionSchema = new Schema<IContentRevision>(
  {
    number: { type: Number, required: [true, "Revision number is required"] },
    requests: { type: [contentRevisionRequestSchema], default: [] },
    responses: { type: [contentRevisionRequestSchema], default: [] },
    requestedAt: { type: Date, default: Date.now },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User" },
    requestedByName: { type: String, trim: true },
    submittedAt: { type: Date },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User" },
    submittedByName: { type: String, trim: true },
    note: {
      type: String,
      trim: true,
      maxlength: [CONTENT_REVISION_NOTE_MAX_LENGTH, `Note cannot exceed ${CONTENT_REVISION_NOTE_MAX_LENGTH} characters`],
    },
  },
  { _id: false }
);

// A comment needs words, files, or both.
contentCommentSchema.pre("validate", function () {
  if (!this.text?.trim() && !this.attachments?.length) this.invalidate("text", "Write a comment or attach a file");
});

const contentSchema = new Schema<IContent>(
  {
    client: { type: Schema.Types.ObjectId, ref: "Client", required: [true, "Client is required"], index: true },
    type: { type: String, enum: CONTENT_TYPES, required: [true, "Content type is required"] },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [CONTENT_TITLE_MAX_LENGTH, `Title cannot exceed ${CONTENT_TITLE_MAX_LENGTH} characters`],
    },

    group: { type: Schema.Types.ObjectId, index: true },

    batchMonth: { type: String, required: [true, "Batch month is required"], trim: true },
    // No default on purpose: a record saved before batchType existed is read from its
    // isIndividual flag in the pre-validate hook, and a default would hide that.
    batchType: { type: String, enum: CONTENT_BATCH_TYPES },
    weekStart: { type: Date },
    eventName: {
      type: String,
      trim: true,
      maxlength: [CONTENT_EVENT_NAME_MAX_LENGTH, `Event name cannot exceed ${CONTENT_EVENT_NAME_MAX_LENGTH} characters`],
    },
    eventDate: { type: Date },
    sentReason: {
      type: String,
      trim: true,
      maxlength: [CONTENT_SENT_REASON_MAX_LENGTH, `Reason cannot exceed ${CONTENT_SENT_REASON_MAX_LENGTH} characters`],
    },
    isIndividual: { type: Boolean, default: false },

    status: { type: String, enum: CONTENT_STATUSES, default: "draft" },
    revisionCount: { type: Number, default: 0 },
    revisions: { type: [contentRevisionSchema], default: [] },

    files: {
      type: [contentFileSchema],
      default: [],
      validate: {
        validator: (files: IContentFile[]) => files.length <= CONTENT_MAX_FILES,
        message: `A piece can have at most ${CONTENT_MAX_FILES} files`,
      },
    },
    link: { type: String, trim: true, maxlength: [CONTENT_URL_MAX_LENGTH, "Link is too long"] },
    previousFiles: { type: [contentPreviousFileSchema], default: [] },

    pageName: { type: String, trim: true, maxlength: [120, "Page name cannot exceed 120 characters"] },
    pageUrl: { type: String, trim: true, maxlength: [CONTENT_URL_MAX_LENGTH, "Page URL is too long"] },
    subject: {
      type: String,
      trim: true,
      maxlength: [CONTENT_SUBJECT_MAX_LENGTH, `Subject cannot exceed ${CONTENT_SUBJECT_MAX_LENGTH} characters`],
    },
    headline: {
      type: String,
      trim: true,
      maxlength: [CONTENT_HEADLINE_MAX_LENGTH, `Headline cannot exceed ${CONTENT_HEADLINE_MAX_LENGTH} characters`],
    },
    cta: {
      type: String,
      enum: { values: [...CONTENT_CTAS, ""], message: `Button must be one of: ${CONTENT_CTAS.join(", ")}` },
      trim: true,
    },

    caption: {
      type: String,
      trim: true,
      maxlength: [CONTENT_CAPTION_MAX_LENGTH, `Caption cannot exceed ${CONTENT_CAPTION_MAX_LENGTH} characters`],
    },
    tags: { type: [{ type: String, trim: true }], default: [] },

    imageUrl: { type: String, trim: true },
    imageAlt: { type: String, trim: true },
    videoUrl: { type: String, trim: true },
    docName: { type: String, trim: true },
    docTitle: { type: String, trim: true },
    docUrl: { type: String, trim: true },

    comments: { type: [contentCommentSchema], default: [] },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    submittedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
  },
  { timestamps: true }
);

// The upload screen: everything for one client in one month.
contentSchema.index({ client: 1, batchMonth: 1, createdAt: -1 });
// One batch within a month (weekly / event / individual).
contentSchema.index({ client: 1, batchMonth: 1, batchType: 1, createdAt: -1 });
// The approval queue: one client's items by status.
contentSchema.index({ client: 1, status: 1, createdAt: -1 });
// Company-wide queue across all clients.
contentSchema.index({ status: 1, createdAt: -1 });

// The single URL an older record carried for its type, before `files` existed.
const legacyUrlOf = (content: IContent) =>
  content.type === "image" ? content.imageUrl : content.type === "video" ? content.videoUrl : content.type === "blog" ? content.docUrl : undefined;

contentSchema.pre("validate", function () {
  // Older records only knew isIndividual — read that as the batch type.
  if (!this.batchType) this.batchType = this.isIndividual ? "individual" : "monthly";
  this.isIndividual = this.batchType === "individual";

  // Keep the single-URL fields filled in from files / link for older readers.
  if (this.files.length || this.link) {
    const firstOf = (media: ContentMedia) => this.files.find((file) => file.media === media);
    this.imageUrl = firstOf("image")?.url;
    this.videoUrl = firstOf("video")?.url ?? (CONTENT_KIND_RULES[this.type]?.media.includes("video") ? this.link : undefined);
    this.docUrl = firstOf("doc")?.url ?? (CONTENT_KIND_RULES[this.type]?.media.includes("doc") ? this.link : undefined);
    const doc = firstOf("doc");
    if (doc && !this.docName) this.docName = doc.name;
  }

  // Each kind only makes sense with its own files and fields.
  const rules = CONTENT_KIND_RULES[this.type];
  if (rules) {
    const label = KIND_LABELS[this.type];
    const fileCount = this.files.length || (legacyUrlOf(this) ? 1 : 0);
    const hasLink = rules.allowLink && Boolean(this.link?.trim());
    if (fileCount < rules.minFiles && !hasLink) {
      this.invalidate(
        "files",
        rules.minFiles > 1
          ? `${withArticle(label)} needs at least ${rules.minFiles} files`
          : `Upload a file${rules.allowLink ? " or add a link" : ""} for this ${label}`
      );
    }
    const wrong = this.files.find((file) => !rules.media.includes(file.media));
    if (wrong) this.invalidate("files", `${withArticle(label)} can't include ${wrong.media} files (${wrong.name || "file"})`);
    for (const field of rules.required) {
      if (!this[field]?.trim()) this.invalidate(field, `${FIELD_LABELS[field]} is required for ${withArticle(label).toLowerCase()}`);
    }
  }

  if (this.batchType === "weekly" && !this.weekStart) this.invalidate("weekStart", "Pick the week for weekly content");
  if (this.batchType === "event") {
    if (!this.eventName?.trim()) this.invalidate("eventName", "Event content needs an event name");
    if (!this.eventDate) this.invalidate("eventDate", "Event content needs an event date");
  }
  if (this.batchType === "individual" && !this.sentReason?.trim()) {
    this.invalidate("sentReason", "A reason is required for content sent outside the regular batch");
  }
});

// Moving through the approval steps stamps when (and by whom) it happened;
// sending an item back to draft clears the steps that no longer hold.
contentSchema.pre("save", function () {
  const context = getRequestContext()?.actor;
  const actorId = context?.id;

  if (this.isNew && actorId && !this.createdBy) this.createdBy = new mongoose.Types.ObjectId(actorId);
  if (!this.isModified("status")) return;

  const actor = actorId ? new mongoose.Types.ObjectId(actorId) : undefined;

  if (this.status === "draft") {
    this.submittedAt = undefined;
    this.approvedAt = undefined;
    this.approvedBy = undefined;
    return;
  }
  if (!this.submittedAt) this.submittedAt = new Date();
  // Each move into revision is one more round — more feedback during a round isn't. The round
  // gets its record here, unless whoever asked already wrote it (with what they asked for).
  if (this.status === "revision_requested") {
    const number = (this.revisionCount ?? 0) + 1;
    this.revisionCount = number;
    if (!this.revisions.some((revision) => revision.number === number)) {
      this.revisions.push({ number, requests: [], responses: [], requestedAt: new Date(), requestedBy: actor, requestedByName: context?.name });
    }
  }
  // Sent (back) to the client: that is the team's answer to the round still open, if there is one.
  if (this.status === "pending_approval") {
    const open = this.revisions[this.revisions.length - 1];
    if (open && !open.submittedAt) {
      open.submittedAt = new Date();
      open.submittedBy = actor;
      open.submittedByName = context?.name;
    }
  }
  if (this.status === "pending_approval" || this.status === "revision_requested") {
    this.approvedAt = undefined;
    this.approvedBy = undefined;
    return;
  }
  if (!this.approvedAt) {
    this.approvedAt = new Date();
    this.approvedBy = actor;
  }
});

contentSchema.plugin(auditPlugin, {
  resource: "Content",
  clientField: "client",
  actionByField: { status: "status_changed" },
});

export const Content = mongoose.model<IContent>("Content", contentSchema);
