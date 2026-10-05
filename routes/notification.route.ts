import { Router } from "express";
import {
  listNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../controllers/notification.controller";
import { protect } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { listNotificationsRules, markNotificationsReadRules, notificationIdRule } from "../validators/notification.validator";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: >
 *     What the signed-in person has been told about — staff and clients alike, each their own only.
 *     Notifications are created by the system when something happens on a piece of content; there
 *     is no endpoint to create one.
 */

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: List my notifications, newest first
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: unread, schema: { type: boolean }, description: Only the ones not read yet }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Notifications fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Notification'
 *                     unread: { type: integer, description: 'All my unread notifications, whatever is listed' }
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *                         totalPages: { type: integer }
 */
router.get("/", protect, listNotificationsRules, validate, listNotifications);

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: How many of my notifications are unread
 *     description: The number on the bell.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     unread: { type: integer }
 */
router.get("/unread-count", protect, countUnreadNotifications);

/**
 * @swagger
 * /notifications/read-all:
 *   patch:
 *     summary: Mark all my notifications as read — or just the ones listed
 *     description: >
 *       With no body, everything unread is marked. With `ids`, only those are — what the bell has
 *       just shown — so anything not seen yet stays unread. Ids that aren't mine are ignored.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids: { type: array, minItems: 1, maxItems: 100, items: { type: string } }
 *     responses:
 *       200:
 *         description: Marked as read — `updated` says how many were unread, `unread` how many still are
 *       422:
 *         description: Validation failed
 */
router.patch("/read-all", protect, markNotificationsReadRules, validate, markAllNotificationsRead);

/**
 * @swagger
 * /notifications/{id}/read:
 *   patch:
 *     summary: Mark one of my notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Notification marked as read — with my unread count afterwards
 *       404:
 *         description: Not found, or not mine
 */
router.patch("/:id/read", protect, notificationIdRule, validate, markNotificationRead);

export default router;
