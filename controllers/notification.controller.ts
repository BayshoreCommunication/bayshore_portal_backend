import type { Request, Response } from "express";
import { Notification } from "../models/notification.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";

// Everyone — staff and clients alike — reads and clears their own notifications here,
// and only their own: every query is tied to the signed-in user.

const unreadCountOf = (userId: unknown) => Notification.countDocuments({ recipient: userId, readAt: null });

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const me = req.user!._id;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const onlyUnread = String(req.query.unread) === "true";

  const filter = { recipient: me, ...(onlyUnread ? { readAt: null } : {}) };

  const [items, total, unread] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
    // Always the whole unread count — for the bell — whatever is being listed.
    unreadCountOf(me),
  ]);

  return ApiResponse(res, 200, "Notifications fetched successfully", {
    items,
    unread,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// Just the number on the bell — cheap enough to ask for often.
export const countUnreadNotifications = asyncHandler(async (req: Request, res: Response) => {
  return ApiResponse(res, 200, "Unread count fetched successfully", { unread: await unreadCountOf(req.user!._id) });
});

export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  const me = req.user!._id;

  // Same answer whether it doesn't exist or is someone else's.
  const notification = await Notification.findOne({ _id: req.params.id, recipient: me });
  if (!notification) throw new ApiError(404, "Notification not found");

  // Reading it again doesn't move when it was first read.
  if (!notification.readAt) {
    notification.readAt = new Date();
    await notification.save();
  }

  return ApiResponse(res, 200, "Notification marked as read", { notification, unread: await unreadCountOf(me) });
});

// Everything of mine that is unread — or, given `ids`, just those: the ones the bell has
// just shown, so that what hasn't been seen yet stays unread.
export const markAllNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  const me = req.user!._id;
  const ids = req.body?.ids as string[] | undefined;

  const result = await Notification.updateMany(
    { recipient: me, readAt: null, ...(ids ? { _id: { $in: ids } } : {}) },
    { $set: { readAt: new Date() } }
  );

  return ApiResponse(res, 200, ids ? "Notifications marked as read" : "All notifications marked as read", {
    updated: result.modifiedCount,
    unread: await unreadCountOf(me),
  });
});
