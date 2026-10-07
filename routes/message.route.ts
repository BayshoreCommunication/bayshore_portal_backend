import { Router } from "express";
import {
  countUnreadMessages,
  getRealtimeTicket,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from "../controllers/message.controller";
import { protect, authorize } from "../middleware/auth";
import { commentUpload } from "../middleware/upload";
import { validate } from "../middleware/validate";
import { USER_ROLES, type UserRole } from "../models/user.model";
import { conversationIdRule, listConversationsRules, listMessagesRules, sendMessageRules } from "../validators/message.validator";

const router = Router();

// Any staff member can read and write the conversations of the clients they can see.
const STAFF_ROLES = USER_ROLES.filter((role) => role !== "client") as UserRole[];

/**
 * @swagger
 * tags:
 *   name: Messages
 *   description: The conversation between each client and the BayShore team
 */

/**
 * @swagger
 * /messages/realtime-ticket:
 *   get:
 *     summary: A short-lived ticket for connecting to live updates (Socket.io)
 *     description: >
 *       Connect to the API's Socket.io endpoint with the ticket as the "ticket" auth value. The connection then
 *       receives a "messages:new" event for every new message in a conversation the caller may see, and a
 *       "notifications:new" event when the caller gets a new notification.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Ticket issued, valid for 15 minutes
 */
router.get("/realtime-ticket", protect, getRealtimeTicket);

/**
 * @swagger
 * /messages/unread-count:
 *   get:
 *     summary: How many messages the caller has not read, across every conversation they are in
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count
 */
router.get("/unread-count", protect, countUnreadMessages);

/**
 * @swagger
 * /messages/conversations:
 *   get:
 *     summary: Staff — the conversations of the clients they can see, most recently active first
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 50 } }
 *     responses:
 *       200:
 *         description: Each conversation with its client, latest message and unread count
 */
router.get("/conversations", protect, authorize(...STAFF_ROLES), listConversationsRules, validate, listConversations);

/**
 * @swagger
 * /messages/me:
 *   get:
 *     summary: Client — a page of their own company's conversation, oldest first
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 30 } }
 *       - { in: query, name: before, schema: { type: string, format: date-time }, description: Only messages older than this (for scrolling back) }
 *       - { in: query, name: content, schema: { type: string }, description: Only messages about this piece of content }
 *     responses:
 *       200:
 *         description: Messages, whether there are older ones, and the caller's unread count
 *   post:
 *     summary: Client — send a message in their own company's conversation
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       description: Text, up to 5 attached files (images, videos, documents), or both.
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               text: { type: string, maxLength: 2000 }
 *               content: { type: string, description: The piece of content the message is about }
 *               files: { type: array, maxItems: 5, items: { type: string, format: binary } }
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text: { type: string, maxLength: 2000 }
 *               content: { type: string }
 *     responses:
 *       201:
 *         description: Message sent
 *       422:
 *         description: Validation failed
 */
router.get("/me", protect, authorize("client"), listMessagesRules, validate, listMessages);
router.post("/me", protect, authorize("client"), commentUpload, sendMessageRules, validate, sendMessage);

/**
 * @swagger
 * /messages/me/read:
 *   patch:
 *     summary: Client — mark their conversation as read
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Marked as read
 */
router.patch("/me/read", protect, authorize("client"), markConversationRead);

/**
 * @swagger
 * /messages/{clientId}:
 *   get:
 *     summary: Staff — a page of a client's conversation, oldest first
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: clientId, required: true, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 30 } }
 *       - { in: query, name: before, schema: { type: string, format: date-time } }
 *       - { in: query, name: content, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Messages, whether there are older ones, and the caller's unread count
 *       404:
 *         description: No such client, or not one the caller can see
 *   post:
 *     summary: Staff — send a message, or add a meeting, in a client's conversation
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: clientId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               kind: { type: string, enum: [text, meeting], default: text }
 *               text: { type: string, maxLength: 2000 }
 *               content: { type: string }
 *               meeting:
 *                 type: object
 *                 description: Required when kind is meeting
 *                 properties:
 *                   title: { type: string, maxLength: 150 }
 *                   startsAt: { type: string, format: date-time }
 *                   endsAt: { type: string, format: date-time }
 *                   location: { type: string, maxLength: 200 }
 *                   link: { type: string }
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               text: { type: string, maxLength: 2000 }
 *               content: { type: string }
 *               files: { type: array, maxItems: 5, items: { type: string, format: binary } }
 *     responses:
 *       201:
 *         description: Message sent
 *       404:
 *         description: No such client, or not one the caller can see
 *       422:
 *         description: Validation failed
 */
router.get("/:clientId", protect, authorize(...STAFF_ROLES), conversationIdRule, listMessagesRules, validate, listMessages);
router.post("/:clientId", protect, authorize(...STAFF_ROLES), commentUpload, conversationIdRule, sendMessageRules, validate, sendMessage);

/**
 * @swagger
 * /messages/{clientId}/read:
 *   patch:
 *     summary: Staff — mark a client's conversation as read
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: clientId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Marked as read
 *       404:
 *         description: No such client, or not one the caller can see
 */
router.patch("/:clientId/read", protect, authorize(...STAFF_ROLES), conversationIdRule, validate, markConversationRead);

export default router;
