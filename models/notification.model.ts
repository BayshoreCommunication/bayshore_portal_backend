import mongoose, { Schema, Document } from "mongoose";

// ── What a notification is about ─────────────────────────────────────────────

// Something happened on a piece of content that the other side should know about.
//
// To the client (their portal):
//   content_sent        the team sent one or more pieces for approval
//   content_resubmitted the team sent a piece back after making the requested changes
//   content_comment     the team replied on a piece's comments
//
// To the staff on that client (the company portal):
//   content_feedback        the client asked for changes
//   content_approved        the client approved a piece
//   content_caption_edited  the client rewrote a piece's caption or tags
export const NOTIFICATION_TYPES = [
  "content_sent",
  "content_resubmitted",
  "content_comment",
  "content_feedback",
  "content_approved",
  "content_caption_edited",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TITLE_MAX_LENGTH = 160;
export const NOTIFICATION_BODY_MAX_LENGTH = 300;

export interface INotification extends Document {
  // Who it is for. One record per person — each reads (and clears) their own.
  recipient: mongoose.Types.ObjectId;
  type: NotificationType;

  // The line shown in the bell, e.g. "Carter Injury Law asked for changes".
  title: string;
  // A second line: the piece's title, or the start of the comment.
  body?: string;
  // Where it opens, as a path in the recipient's own portal — e.g. "/content/<id>".
  link: string;

  // Who did it. The name is kept as it was, even if the user is later renamed or deleted.
  actor?: mongoose.Types.ObjectId;
  actorName?: string;

  // What it concerns: the client, and the piece (the first one, when several were sent together).
  client?: mongoose.Types.ObjectId;
  content?: mongoose.Types.ObjectId;
  // How many pieces it covers — more than 1 when several were sent together.
  pieces: number;

  // Missing until the recipient has read it.
  readAt?: Date;

  createdAt: Date;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     Notification:
 *       type: object
 *       description: >
 *         Tells one person that something happened on a piece of content. Clients are told when the
 *         team sends or re-sends content or replies to a comment; the staff on a client are told when
 *         the client asks for changes, approves, or edits a caption. Kept for 90 days, then deleted
 *         automatically.
 *       properties:
 *         _id: { type: string }
 *         recipient: { type: string, description: User id of the person it is for }
 *         type:
 *           type: string
 *           enum: [content_sent, content_resubmitted, content_comment, content_feedback, content_approved, content_caption_edited]
 *         title: { type: string, example: Carter Injury Law asked for changes }
 *         body: { type: string, description: 'The piece''s title, or the start of the comment' }
 *         link: { type: string, description: 'Path in the recipient''s own portal', example: /content/665f1c2ab7e4c81d9a0f3b21 }
 *         actor: { type: string, description: User id of whoever did it }
 *         actorName: { type: string, description: Their name at the time }
 *         client: { type: string, description: Client it concerns }
 *         content: { type: string, description: 'The piece it concerns (the first, when several were sent together)' }
 *         pieces: { type: integer, description: How many pieces it covers, example: 1 }
 *         readAt: { type: string, format: date-time, description: Missing until the recipient has read it }
 *         createdAt: { type: string, format: date-time }
 */
const notificationSchema = new Schema<INotification>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: [true, "Recipient is required"] },
    type: { type: String, enum: NOTIFICATION_TYPES, required: [true, "Notification type is required"] },

    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [NOTIFICATION_TITLE_MAX_LENGTH, `Title cannot exceed ${NOTIFICATION_TITLE_MAX_LENGTH} characters`],
    },
    body: {
      type: String,
      trim: true,
      maxlength: [NOTIFICATION_BODY_MAX_LENGTH, `Body cannot exceed ${NOTIFICATION_BODY_MAX_LENGTH} characters`],
    },
    link: {
      type: String,
      required: [true, "Link is required"],
      trim: true,
      // A path inside the portal, never a full URL — so a notification can't send anyone elsewhere.
      match: [/^\/(?!\/)/, "Link must be a path starting with /"],
    },

    actor: { type: Schema.Types.ObjectId, ref: "User" },
    actorName: { type: String, trim: true },

    client: { type: Schema.Types.ObjectId, ref: "Client" },
    content: { type: Schema.Types.ObjectId, ref: "Content" },
    pieces: { type: Number, default: 1, min: [1, "A notification covers at least one piece"] },

    readAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

// One person's notifications, newest first — the bell's dropdown and the Notifications page.
notificationSchema.index({ recipient: 1, createdAt: -1 });
// One person's unread ones — the number on the bell.
notificationSchema.index({ recipient: 1, readAt: 1 });
// Everything about one piece, for clearing up when the piece is deleted.
notificationSchema.index({ content: 1 });

// Kept for 90 days at most; MongoDB deletes older ones on its own (its background
// sweep runs about once a minute).
export const NOTIFICATION_RETENTION_DAYS = 90;
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 });

export const Notification = mongoose.model<INotification>("Notification", notificationSchema);
