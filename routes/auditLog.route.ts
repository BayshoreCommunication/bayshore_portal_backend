import { Router } from "express";
import { listAuditLogs } from "../controllers/auditLog.controller";
import { protect, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { listAuditLogsRules } from "../validators/auditLog.validator";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Audit Logs
 *   description: Append-only history of who created, changed or deleted what (admin/superadmin only)
 */

/**
 * @swagger
 * /audit-logs:
 *   get:
 *     summary: List audit logs, newest first
 *     description: >
 *       Filter by actor, client, resource, resourceId, action and date range.
 *       To show the history of a single record, pass resource and resourceId.
 *     tags: [Audit Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: actor
 *         schema:
 *           type: string
 *         description: User id of who did it
 *       - in: query
 *         name: client
 *         schema:
 *           type: string
 *         description: Only entries that belong to this client
 *       - in: query
 *         name: resource
 *         schema:
 *           type: string
 *           example: User
 *       - in: query
 *         name: resourceId
 *         schema:
 *           type: string
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [create, update, delete, restore, login, login_failed, logout, token_reuse_detected, password_changed, role_changed, status_changed, approve, reject, publish, convert, export, other]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Audit logs fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     logs:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/AuditLog'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         total:
 *                           type: integer
 *                         totalPages:
 *                           type: integer
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Not allowed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       422:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.get("/", protect, authorize("admin", "superadmin"), listAuditLogsRules, validate, listAuditLogs);

export default router;
