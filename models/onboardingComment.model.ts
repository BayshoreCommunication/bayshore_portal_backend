import mongoose, { Schema, Document, Types } from "mongoose";
import { CONTENT_MEDIA, type IContentFile } from "./content.model";

// ── Comments on a client's onboarding form ───────────────────────────────────

// A client writes a comment on one step of their onboarding form (client-portal: StepComments)
// — a question, or a note about an answer — with files if they like. The team answers it from
// the client's onboarding in the company portal, and the replies show under the comment on the
// client's form. The team can start one too (the client's page in the company portal): it shows
// on that step of the client's form, from the team.

// Who wrote a comment: the client, or the BayShore team.
export const ONBOARDING_COMMENT_SIDES = ["client", "team"] as const;
export type OnboardingCommentSide = (typeof ONBOARDING_COMMENT_SIDES)[number];

// The steps of the onboarding form, as both portals name them.
export const ONBOARDING_COMMENT_STEPS = ["contact", "web", "domain", "email", "logo", "google", "social", "media"] as const;
export type OnboardingCommentStep = (typeof ONBOARDING_COMMENT_STEPS)[number];

export const ONBOARDING_COMMENT_MAX_LENGTH = 1000;
// An item of a step a comment is about ("social.facebook"), and its name as the form shows it.
export const ONBOARDING_COMMENT_ITEM_MAX_LENGTH = 80;
export const ONBOARDING_COMMENT_ITEM_LABEL_MAX_LENGTH = 120;
export const ONBOARDING_COMMENT_MAX_FILES = 5;

// A reply from the BayShore team.
export interface IOnboardingCommentReply {
  _id: Types.ObjectId;
  author: Types.ObjectId;
  // Their name as it was when they wrote it.
  authorName: string;
  text: string;
  files: IContentFile[];
  createdAt: Date;
}

export interface IOnboardingComment extends Document {
  client: Types.ObjectId;
  step: OnboardingCommentStep;
  // The item of the step it is about, when it is about one ("social.facebook"), and its name.
  item?: string;
  itemLabel?: string;
  side: OnboardingCommentSide;
  // Who wrote it, and their name as it was then.
  author: Types.ObjectId;
  authorName: string;
  text: string;
  files: IContentFile[];
  replies: IOnboardingCommentReply[];
  createdAt: Date;
  updatedAt: Date;
}

const fileSchema = new Schema<IContentFile>(
  {
    url: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: Number, required: true },
    mimeType: { type: String, required: true },
    media: { type: String, enum: CONTENT_MEDIA, required: true },
  },
  { _id: false }
);

const textField = {
  type: String,
  trim: true,
  default: "",
  maxlength: [ONBOARDING_COMMENT_MAX_LENGTH, `A comment cannot exceed ${ONBOARDING_COMMENT_MAX_LENGTH} characters`] as [number, string],
};

const replySchema = new Schema<IOnboardingCommentReply>(
  {
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true, trim: true },
    text: textField,
    files: { type: [fileSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const onboardingCommentSchema = new Schema<IOnboardingComment>(
  {
    client: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    step: { type: String, enum: ONBOARDING_COMMENT_STEPS, required: true },
    item: { type: String, trim: true, maxlength: ONBOARDING_COMMENT_ITEM_MAX_LENGTH },
    itemLabel: { type: String, trim: true, maxlength: ONBOARDING_COMMENT_ITEM_LABEL_MAX_LENGTH },
    // Missing on comments from before the team could start one: those are all the client's.
    side: { type: String, enum: ONBOARDING_COMMENT_SIDES, default: "client" },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true, trim: true },
    text: textField,
    files: { type: [fileSchema], default: [] },
    replies: { type: [replySchema], default: [] },
  },
  { timestamps: true }
);

// A client's comments, in the order they were written.
onboardingCommentSchema.index({ client: 1, createdAt: 1 });

export const OnboardingComment = mongoose.model<IOnboardingComment>("OnboardingComment", onboardingCommentSchema);
