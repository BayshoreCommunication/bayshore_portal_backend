import type { Request, Response } from "express";
import type { FilterQuery } from "mongoose";
import { Client } from "../models/client.model";
import { Content, type IContent } from "../models/content.model";
import { Message, MessageRead, type IMessage, type MessageSide } from "../models/message.model";
import { Notification } from "../models/notification.model";
import type { IUser } from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { createMessageRealtimeTicket } from "../realtime/messagesRealtime";
import { ApiError } from "../utils/ApiError";
import { ApiResponse } from "../utils/ApiResponse";
import { removeFiles, uploadAttachments } from "../utils/attachments";
import { FULL_ACCESS_ROLES, canAccessClient, clientScopeFor } from "../utils/clientAccess";
import { postMessage, sideOf } from "../utils/messages";

// Each client has one conversation with the BayShore team (models/message.model.ts). A client
// login reads and writes its own company's; staff, the conversation of any client they can see.

const DEFAULT_PAGE = 30;

// Whose conversation this request is about: the caller's own company for a client login
// (the /me routes), otherwise the client named in the path — which the caller must be able
// to see. Same answer whether that client doesn't exist or isn't theirs.
const conversationOf = async (req: Request) => {
  const user = req.user!;
  if (user.role === "client") {
    if (!user.client) throw new ApiError(403, "This account is not linked to a client");
    return user.client;
  }
  if (!(await canAccessClient(user, req.params.clientId))) throw new ApiError(404, "Conversation not found");
  const client = await Client.findById(req.params.clientId).select("_id");
  if (!client) throw new ApiError(404, "Conversation not found");
  return client._id;
};

// What the other side has written — the only messages that can be unread for someone.
const otherSide = (user: IUser): MessageSide => (sideOf(user) === "client" ? "team" : "client");

const readAtOf = async (user: IUser, clientId: unknown) => (await MessageRead.findOne({ user: user._id, client: clientId }).lean())?.readAt;

const unreadIn = async (user: IUser, clientId: unknown, readAt?: Date) =>
  Message.countDocuments({ client: clientId, side: otherSide(user), ...(readAt ? { createdAt: { $gt: readAt } } : {}) });

// Marks the conversation read up to now, and clears the "new message" notifications about it.
const markRead = async (user: IUser, clientId: unknown) => {
  const now = new Date();
  await Promise.all([
    MessageRead.updateOne({ user: user._id, client: clientId }, { $set: { readAt: now } }, { upsert: true }),
    Notification.updateMany({ recipient: user._id, type: "message", client: clientId, readAt: null }, { $set: { readAt: now } }),
  ]);
  return now;
};

// ── Live updates ─────────────────────────────────────────────────────────────

// A short-lived ticket the browser connects to Socket.io with: it names the caller and the
// conversations they may hear.
export const getRealtimeTicket = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  let clients: string[] | "all";
  if (user.role === "client") clients = user.client ? [String(user.client)] : [];
  else if (FULL_ACCESS_ROLES.includes(user.role)) clients = "all";
  else clients = (await Client.find(clientScopeFor(user)).distinct("_id")).map(String);

  return ApiResponse(res, 200, "Realtime ticket issued", { ticket: createMessageRealtimeTicket(String(user._id), clients), expiresIn: 15 * 60 });
});

// ── Reading ──────────────────────────────────────────────────────────────────

// A page of a conversation, oldest first — the newest page by default, the one before
// `before` (a message's createdAt) when scrolling back. `content` narrows it to one piece.
export const listMessages = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const clientId = await conversationOf(req);
  const limit = Number(req.query.limit) || DEFAULT_PAGE;
  const before = req.query.before ? new Date(String(req.query.before)) : undefined;

  const filter: FilterQuery<IMessage> = { client: clientId };
  if (req.query.content) filter.content = req.query.content;
  if (before) filter.createdAt = { $lt: before };

  const [page, readAt] = await Promise.all([
    Message.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
    readAtOf(user, clientId),
  ]);
  const hasMore = page.length > limit;
  const items = page.slice(0, limit).reverse();

  return ApiResponse(res, 200, "Messages fetched successfully", {
    items,
    hasMore,
    // When the caller last read the conversation, and how much the other side has written since.
    readAt: readAt ?? null,
    unread: await unreadIn(user, clientId, readAt),
  });
});

// Staff: the conversations of the clients they can see, the most recently active first,
// each with its latest message and how much of it is unread.
export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const limit = Number(req.query.limit) || 50;
  const scope = FULL_ACCESS_ROLES.includes(user.role) ? {} : { client: { $in: await Client.find(clientScopeFor(user)).distinct("_id") } };

  const latest = await Message.aggregate<{ _id: IMessage["client"]; last: IMessage }>([
    { $match: scope },
    { $sort: { createdAt: -1, _id: -1 } },
    { $group: { _id: "$client", last: { $first: "$$ROOT" } } },
    { $sort: { "last.createdAt": -1 } },
    { $limit: limit },
  ]);
  const ids = latest.map((row) => row._id);

  const [clients, reads] = await Promise.all([
    Client.find({ _id: { $in: ids } }).select("companyName contactName").lean(),
    MessageRead.find({ user: user._id, client: { $in: ids } }).lean(),
  ]);
  const clientById = new Map(clients.map((client) => [String(client._id), client]));
  const readAtById = new Map(reads.map((read) => [String(read.client), read.readAt]));

  const items = await Promise.all(
    latest.map(async ({ _id, last }) => ({
      client: clientById.get(String(_id)) ?? { _id },
      last,
      unread: await unreadIn(user, _id, readAtById.get(String(_id))),
    }))
  );

  return ApiResponse(res, 200, "Conversations fetched successfully", {
    items,
    unread: items.reduce((sum, item) => sum + item.unread, 0),
  });
});

// The number for a badge: everything unread, across every conversation the caller is in.
export const countUnreadMessages = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;

  if (user.role === "client") {
    if (!user.client) throw new ApiError(403, "This account is not linked to a client");
    return ApiResponse(res, 200, "Unread count fetched successfully", { unread: await unreadIn(user, user.client, await readAtOf(user, user.client)) });
  }

  const scope = FULL_ACCESS_ROLES.includes(user.role) ? {} : { client: { $in: await Client.find(clientScopeFor(user)).distinct("_id") } };
  // Only conversations where the client has written at all can have anything unread.
  const ids = await Message.find({ ...scope, side: "client" }).distinct("client");
  const reads = await MessageRead.find({ user: user._id, client: { $in: ids } }).lean();
  const readAtById = new Map(reads.map((read) => [String(read.client), read.readAt]));
  const counts = await Promise.all(ids.map((id) => unreadIn(user, id, readAtById.get(String(id)))));

  return ApiResponse(res, 200, "Unread count fetched successfully", { unread: counts.reduce((sum, count) => sum + count, 0) });
});

// ── Writing ──────────────────────────────────────────────────────────────────

// A message: words, files, or both — or, from staff, a meeting for the client's diary.
// `content` ties it to a piece (it was written from that piece's page).
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const clientId = await conversationOf(req);
  const kind: "text" | "meeting" = req.body.kind === "meeting" ? "meeting" : "text";

  if (kind === "meeting" && user.role === "client") throw new ApiError(403, "Meetings are added by the BayShore team");

  // The piece it is about must be this client's — and, for the client, one they have been sent.
  let content: Pick<IContent, "_id" | "title"> | undefined;
  if (req.body.content) {
    const found = await Content.findOne({
      _id: req.body.content,
      client: clientId,
      ...(user.role === "client" ? { status: { $ne: "draft" } } : {}),
    }).select("title");
    if (!found) throw new ApiError(404, "Content not found");
    content = found;
  }

  const files = ((req.files ?? {}) as Record<string, Express.Multer.File[]>).files ?? [];
  const attachments = await uploadAttachments(files, "messages");

  try {
    const message = await postMessage(user, {
      client: clientId,
      kind,
      text: req.body.text ?? "",
      attachments,
      content,
      meeting:
        kind === "meeting"
          ? {
              title: req.body.meeting?.title,
              startsAt: new Date(req.body.meeting?.startsAt),
              endsAt: req.body.meeting?.endsAt ? new Date(req.body.meeting.endsAt) : undefined,
              location: req.body.meeting?.location || undefined,
              link: req.body.meeting?.link || undefined,
            }
          : undefined,
    });
    // Whoever writes has, by writing, read what came before.
    await markRead(user, clientId);
    return ApiResponse(res, 201, "Message sent", message);
  } catch (error) {
    await removeFiles(attachments.map((file) => file.url));
    throw error;
  }
});

// The caller has seen the conversation: nothing in it is unread for them any more.
export const markConversationRead = asyncHandler(async (req: Request, res: Response) => {
  const clientId = await conversationOf(req);
  const readAt = await markRead(req.user!, clientId);
  return ApiResponse(res, 200, "Conversation marked as read", { readAt, unread: 0 });
});
