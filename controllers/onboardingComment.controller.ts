import type { Request, Response } from "express";
import { Client } from "../models/client.model";
import { OnboardingComment, type IOnboardingComment } from "../models/onboardingComment.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { canAccessClient } from "../utils/clientAccess";
import { removeFiles, uploadAttachments } from "../utils/attachments";
import { announceOnboardingComment } from "../utils/messages";
import { notifyOnboardingComment } from "../utils/notifications";
import { emitToClient } from "../realtime/messagesRealtime";
import type { IUser } from "../models/user.model";

// Comments on a client's onboarding form (models/onboardingComment.model.ts): the client writes
// them on a step of their form, the team replies from the company portal — or starts one there.

// What either portal is shown of a comment: no user ids, just names.
const viewOf = (comment: IOnboardingComment) => ({
  _id: comment._id,
  client: String(comment.client),
  step: comment.step,
  side: comment.side ?? "client",
  authorName: comment.authorName,
  text: comment.text,
  files: comment.files,
  createdAt: comment.createdAt,
  replies: comment.replies.map((reply) => ({
    _id: reply._id,
    authorName: reply.authorName,
    text: reply.text,
    files: reply.files,
    createdAt: reply.createdAt,
  })),
});

// Each step's name, as both onboarding forms call it.
const STEP_TITLES: Record<string, string> = {
  contact: "About you",
  web: "Website",
  domain: "Domain and hosting",
  email: "Business email",
  logo: "Logo",
  google: "Google accounts",
  social: "Social media",
  media: "Photos and videos",
};

// After a comment or a reply is saved: live to everyone on the client's onboarding (and their
// conversation), and a notification to the other side — as a comment on a piece is.
const spread = async (comment: IOnboardingComment, actor: IUser, side: "client" | "team", said: { text: string; files: IOnboardingComment["files"] }, reply = false) => {
  emitToClient(String(comment.client), "onboarding:comment", viewOf(comment));
  const step = STEP_TITLES[comment.step] ?? comment.step;
  await announceOnboardingComment(comment.client, actor, step, said.text, said.files);
  await notifyOnboardingComment(comment.client, actor, { side, step, text: said.text, attachments: said.files.length, reply });
};

const filesOf = (req: Request) => ((req.files ?? {}) as Record<string, Express.Multer.File[]>).files ?? [];

// The client a signed-in client's account belongs to.
const myClientOf = (req: Request) => {
  const client = req.user!.client;
  if (!client) throw new ApiError(403, "This account is not linked to a client");
  return client;
};

// A client the signed-in staff member may work on.
const staffClientOf = async (req: Request) => {
  if (!(await canAccessClient(req.user!, req.params.clientId))) throw new ApiError(404, "Client not found");
  const client = await Client.findById(req.params.clientId).select("_id");
  if (!client) throw new ApiError(404, "Client not found");
  return client._id;
};

const listFor = async (client: unknown) => (await OnboardingComment.find({ client }).sort({ createdAt: 1 })).map(viewOf);

// Words, files, or both: never neither. The files go up only once that is known.
const textAndFiles = async (req: Request, folder: string) => {
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  const files = filesOf(req);
  if (!text && !files.length) throw new ApiError(422, "Write a comment or attach a file");
  return { text, files: await uploadAttachments(files, folder) };
};

// ── The client's side ────────────────────────────────────────────────────────

export const listMyOnboardingComments = asyncHandler(async (req: Request, res: Response) => {
  return ApiResponse(res, 200, "Comments fetched successfully", await listFor(myClientOf(req)));
});

export const addMyOnboardingComment = asyncHandler(async (req: Request, res: Response) => {
  const client = myClientOf(req);
  const { text, files } = await textAndFiles(req, "onboarding-comments");
  try {
    const comment = await OnboardingComment.create({
      client,
      step: req.body.step,
      side: "client",
      author: req.user!._id,
      authorName: req.user!.fullName,
      text,
      files,
    });
    await spread(comment, req.user!, "client", { text, files });
    return ApiResponse(res, 201, "Comment added", viewOf(comment));
  } catch (error) {
    await removeFiles(files.map((file) => file.url));
    throw error;
  }
});

// ── The team's side ──────────────────────────────────────────────────────────

export const listOnboardingComments = asyncHandler(async (req: Request, res: Response) => {
  return ApiResponse(res, 200, "Comments fetched successfully", await listFor(await staffClientOf(req)));
});

// A comment from the team on a step of the client's form, which the client sees there.
export const addOnboardingComment = asyncHandler(async (req: Request, res: Response) => {
  const client = await staffClientOf(req);
  const { text, files } = await textAndFiles(req, "onboarding-comments");
  try {
    const comment = await OnboardingComment.create({
      client,
      step: req.body.step,
      side: "team",
      author: req.user!._id,
      authorName: req.user!.fullName,
      text,
      files,
    });
    await spread(comment, req.user!, "team", { text, files });
    return ApiResponse(res, 201, "Comment added", viewOf(comment));
  } catch (error) {
    await removeFiles(files.map((file) => file.url));
    throw error;
  }
});

export const replyToOnboardingComment = asyncHandler(async (req: Request, res: Response) => {
  const client = await staffClientOf(req);
  const comment = await OnboardingComment.findOne({ _id: req.params.commentId, client });
  if (!comment) throw new ApiError(404, "Comment not found");

  const { text, files } = await textAndFiles(req, "onboarding-comments");
  try {
    comment.replies.push({ author: req.user!._id, authorName: req.user!.fullName, text, files } as never);
    await comment.save();
    await spread(comment, req.user!, "team", { text, files }, true);
    return ApiResponse(res, 201, "Reply added", viewOf(comment));
  } catch (error) {
    await removeFiles(files.map((file) => file.url));
    throw error;
  }
});
