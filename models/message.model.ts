import mongoose, { Schema, Document } from "mongoose";
import { CONTENT_MEDIA, type IContentFile } from "./content.model";

// ── The conversation between a client and BayShore ───────────────────────────

// Every client has one conversation with the BayShore team working on it: there is no
// separate "conversation" record — a message belongs to its client, and the client's
// messages in order are the conversation. Anyone at the client, and any staff member who
// can see the client, reads and writes the same thread.

// What a message is.
//   text                something a person wrote — words, files, or both
//   revision_requested  written automatically: the client asked for changes to a piece
//   revision_submitted  written automatically: the team sent the revised piece back
//   meeting             a call or meeting the team has put in the client's diary
export const MESSAGE_KINDS = ["text", "revision_requested", "revision_submitted", "meeting"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

// The kinds a person can post themselves; the rest are only ever written by the system.
export const MESSAGE_POSTABLE_KINDS = ["text", "meeting"] as const;

// Which side of the conversation a message sits on — an automatic one included: it stands
// on the side of whoever did the thing it reports.
export const MESSAGE_SIDES = ["client", "team"] as const;
export type MessageSide = (typeof MESSAGE_SIDES)[number];

export const MESSAGE_TEXT_MAX_LENGTH = 2000;
export const MESSAGE_MAX_ATTACHMENTS = 5;
export const MEETING_TITLE_MAX_LENGTH = 150;
export const MEETING_LOCATION_MAX_LENGTH = 200;
export const MEETING_LINK_MAX_LENGTH = 2000;

// A call or meeting, as shown in the conversation.
export interface IMessageMeeting {
  title: string;
  startsAt: Date;
  endsAt?: Date;
  // Where it happens: a place, or "Video call".
  location?: string;
  // The link to join, when it is online.
  link?: string;
}

export interface IMessage extends Document {
  // The conversation: the client it is with.
  client: mongoose.Types.ObjectId;
  kind: MessageKind;
  side: MessageSide;

  // Who wrote it (or did what it reports). The name is kept as it was, even if the user is
  // later renamed or deleted.
  sender?: mongoose.Types.ObjectId;
  senderName?: string;

  // May be empty when the message is only files, or an automatic one with nothing to add.
  text: string;
  attachments: IContentFile[];

  // The piece of content it is about: always for the automatic revision messages, and for a
  // message written from a piece's own page. The title is kept as it was.
  content?: mongoose.Types.ObjectId;
  contentTitle?: string;
  // Which revision of that piece, for the automatic revision messages.
  revision?: number;

  // The meeting, for a meeting message.
  meeting?: IMessageMeeting;

  createdAt: Date;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     Message:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         client: { type: string, description: The client whose conversation this is in }
 *         kind: { type: string, enum: [text, revision_requested, revision_submitted, meeting] }
 *         side: { type: string, enum: [client, team], description: Which side of the conversation it sits on }
 *         sender: { type: string }
 *         senderName: { type: string }
 *         text: { type: string }
 *         attachments: { type: array, items: { $ref: '#/components/schemas/ContentFile' } }
 *         content: { type: string, description: The piece of content it is about, if any }
 *         contentTitle: { type: string }
 *         revision: { type: integer, description: Which revision of that piece, on the automatic revision messages }
 *         meeting:
 *           type: object
 *           properties:
 *             title: { type: string }
 *             startsAt: { type: string, format: date-time }
 *             endsAt: { type: string, format: date-time }
 *             location: { type: string }
 *             link: { type: string }
 *         createdAt: { type: string, format: date-time }
 */

const messageFileSchema = new Schema<IContentFile>(
  {
    url: { type: String, required: [true, "File URL is required"], trim: true },
    name: { type: String, trim: true, default: "" },
    size: { type: Number, default: 0 },
    mimeType: { type: String, trim: true, default: "" },
    media: { type: String, enum: CONTENT_MEDIA, required: [true, "File media is required"] },
  },
  { _id: false }
);

const messageMeetingSchema = new Schema<IMessageMeeting>(
  {
    title: {
      type: String,
      required: [true, "A meeting needs a title"],
      trim: true,
      maxlength: [MEETING_TITLE_MAX_LENGTH, `Meeting title cannot exceed ${MEETING_TITLE_MAX_LENGTH} characters`],
    },
    startsAt: { type: Date, required: [true, "A meeting needs a start time"] },
    endsAt: { type: Date },
    location: {
      type: String,
      trim: true,
      maxlength: [MEETING_LOCATION_MAX_LENGTH, `Location cannot exceed ${MEETING_LOCATION_MAX_LENGTH} characters`],
    },
    link: { type: String, trim: true, maxlength: [MEETING_LINK_MAX_LENGTH, "Meeting link is too long"] },
  },
  { _id: false }
);

const messageSchema = new Schema<IMessage>(
  {
    client: { type: Schema.Types.ObjectId, ref: "Client", required: [true, "Client is required"] },
    kind: { type: String, enum: MESSAGE_KINDS, default: "text" },
    side: { type: String, enum: MESSAGE_SIDES, required: [true, "Message side is required"] },

    sender: { type: Schema.Types.ObjectId, ref: "User" },
    senderName: { type: String, trim: true },

    text: {
      type: String,
      trim: true,
      default: "",
      maxlength: [MESSAGE_TEXT_MAX_LENGTH, `Message cannot exceed ${MESSAGE_TEXT_MAX_LENGTH} characters`],
    },
    attachments: {
      type: [messageFileSchema],
      default: [],
      validate: {
        validator: (files: IContentFile[]) => files.length <= MESSAGE_MAX_ATTACHMENTS,
        message: `A message can have at most ${MESSAGE_MAX_ATTACHMENTS} attachments`,
      },
    },

    content: { type: Schema.Types.ObjectId, ref: "Content" },
    contentTitle: { type: String, trim: true },
    revision: { type: Number },

    meeting: { type: messageMeetingSchema },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

// A conversation, newest first — and the part of it about one piece.
messageSchema.index({ client: 1, createdAt: -1 });
messageSchema.index({ client: 1, content: 1, createdAt: -1 });

messageSchema.pre("validate", function () {
  // Something a person writes needs words, files, or both; a meeting needs its details.
  if (this.kind === "text" && !this.text?.trim() && !this.attachments?.length) this.invalidate("text", "Write a message or attach a file");
  if (this.kind === "meeting" && !this.meeting) this.invalidate("meeting", "A meeting message needs the meeting's details");
  if (this.meeting?.endsAt && this.meeting.endsAt < this.meeting.startsAt) this.invalidate("meeting.endsAt", "A meeting can't end before it starts");
});

export const Message = mongoose.model<IMessage>("Message", messageSchema);

// ── Who has read how far ─────────────────────────────────────────────────────

// One record per person per conversation: when they last read it. Whatever the other side
// has written since then is unread for them.
export interface IMessageRead extends Document {
  user: mongoose.Types.ObjectId;
  client: mongoose.Types.ObjectId;
  readAt: Date;
}

const messageReadSchema = new Schema<IMessageRead>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: [true, "User is required"] },
    client: { type: Schema.Types.ObjectId, ref: "Client", required: [true, "Client is required"] },
    readAt: { type: Date, required: [true, "Read time is required"] },
  },
  { versionKey: false }
);

messageReadSchema.index({ user: 1, client: 1 }, { unique: true });

export const MessageRead = mongoose.model<IMessageRead>("MessageRead", messageReadSchema);
