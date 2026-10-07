import { Router } from "express";
import {
  createReport,
  listReports,
  getReport,
  updateReport,
  changeReportStatus,
  deleteReport,
  listMyReports,
  getMyReport,
} from "../controllers/report.controller";
import { protect, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  reportIdRule,
  createReportRules,
  updateReportRules,
  changeStatusRules,
  listReportsRules,
  listMyReportsRules,
} from "../validators/report.validator";
import {
  REPORT_READ_ROLES,
  REPORT_WRITE_ROLES,
  REPORT_DELETE_ROLES,
} from "../utils/reportAccess";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: >
 *     Weekly and monthly reports for a client. Staff write them and move them through
 *     draft → submitted → approved → published; clients only ever see published ones.
 *     Staff see the reports of clients they own, are assigned to, or created (admins see all).
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ReportContent:
 *       type: object
 *       description: The body of a report. Send only what you want to change when editing.
 *       properties:
 *         title:
 *           type: string
 *           description: Leave out to get "<Month Year> Performance Report"
 *         summary:
 *           type: string
 *           maxLength: 5000
 *         social:
 *           type: object
 *           properties:
 *             facebookReach: { type: integer, minimum: 0, nullable: true }
 *             instagramReach: { type: integer, minimum: 0, nullable: true }
 *             twitterReach: { type: integer, minimum: 0, nullable: true }
 *             linkedinReach: { type: integer, minimum: 0, nullable: true }
 *             videos:
 *               type: array
 *               description: Replaces the whole list when sent
 *               items:
 *                 type: object
 *                 required: [title]
 *                 properties:
 *                   title: { type: string }
 *                   views: { type: integer, minimum: 0, nullable: true }
 *                   impressions: { type: integer, minimum: 0, nullable: true }
 *             reel:
 *               type: object
 *               description: Older reports only — use `videos`
 *               properties:
 *                 title: { type: string }
 *                 views: { type: integer, minimum: 0, nullable: true }
 *         blogs:
 *           type: array
 *           description: Replaces the whole list when sent
 *           items:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string }
 *               publishedAt: { type: string, format: date-time }
 *               graphicsCount: { type: integer, minimum: 0 }
 *               url: { type: string }
 *         website:
 *           type: object
 *           properties:
 *             impressions: { type: integer, minimum: 0, nullable: true }
 *             clicks: { type: integer, minimum: 0, nullable: true }
 *             backlinks: { type: integer, minimum: 0, nullable: true }
 *             referringDomains: { type: integer, minimum: 0, nullable: true }
 *             leadsForwarded: { type: integer, minimum: 0, nullable: true }
 *         gmb:
 *           type: object
 *           properties:
 *             impressions: { type: integer, minimum: 0, nullable: true }
 *             calls: { type: integer, minimum: 0, nullable: true }
 *             directionRequests: { type: integer, minimum: 0, nullable: true }
 *             websiteClicks: { type: integer, minimum: 0, nullable: true }
 *             locations:
 *               type: array
 *               description: Replaces the whole list when sent
 *               items:
 *                 type: object
 *                 required: [name]
 *                 properties:
 *                   name: { type: string }
 *                   impressions: { type: integer, minimum: 0 }
 *                   calls: { type: integer, minimum: 0 }
 *                   directions: { type: integer, minimum: 0 }
 *     ReportWithPrevious:
 *       type: object
 *       properties:
 *         success: { type: boolean }
 *         message: { type: string }
 *         data:
 *           type: object
 *           properties:
 *             report:
 *               $ref: '#/components/schemas/Report'
 *             previous:
 *               type: object
 *               nullable: true
 *               description: Figures from the last published report of the same type, for the ▲/▼ percentages. Null for the first one.
 */

/**
 * @swagger
 * /reports:
 *   post:
 *     summary: Create a report (starts as a draft)
 *     description: >
 *       Roles: employee, executive, assistant_manager, manager, admin, superadmin — for clients they can see.
 *       One report per client, period type and start date; a second one returns 409.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ReportContent'
 *               - type: object
 *                 required: [client, periodType, periodStart, periodEnd]
 *                 properties:
 *                   client: { type: string, description: Client id }
 *                   periodType: { type: string, enum: [weekly, monthly] }
 *                   periodStart: { type: string, format: date, example: "2026-08-01" }
 *                   periodEnd: { type: string, format: date, example: "2026-08-31" }
 *     responses:
 *       201:
 *         description: Report created successfully
 *       404:
 *         description: Client not found, or not one of your clients
 *       409:
 *         description: A report for this client and period already exists
 *       422:
 *         description: Validation failed
 *   get:
 *     summary: List reports
 *     description: Headlines only (no sections), newest period first, with counts per status across everything you can see.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: client, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [draft, submitted, approved, published] } }
 *       - { in: query, name: periodType, schema: { type: string, enum: [weekly, monthly] } }
 *       - { in: query, name: from, schema: { type: string, format: date }, description: Period start on or after }
 *       - { in: query, name: to, schema: { type: string, format: date }, description: Period start on or before }
 *       - { in: query, name: q, schema: { type: string }, description: Search the title or the client's company name }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Reports fetched successfully
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
 *                     reports:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Report'
 *                     summary:
 *                       type: object
 *                       properties:
 *                         total: { type: integer }
 *                         draft: { type: integer }
 *                         submitted: { type: integer }
 *                         approved: { type: integer }
 *                         published: { type: integer }
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *                         totalPages: { type: integer }
 */
router.post("/", protect, authorize(...REPORT_WRITE_ROLES), createReportRules, validate, createReport);
router.get("/", protect, authorize(...REPORT_READ_ROLES), listReportsRules, validate, listReports);

/**
 * @swagger
 * /reports/me:
 *   get:
 *     summary: The signed-in client's published reports
 *     description: For the client portal. Only published reports of the caller's own company, without staff-only details.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: periodType, schema: { type: string, enum: [weekly, monthly] } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: full, schema: { type: boolean, default: false }, description: Include each report's figures (social, website, gmb), for trends }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Reports fetched successfully
 *       403:
 *         description: Not a client account
 */
router.get("/me", protect, authorize("client"), listMyReportsRules, validate, listMyReports);

/**
 * @swagger
 * /reports/me/{id}:
 *   get:
 *     summary: One of the signed-in client's published reports
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Report fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReportWithPrevious'
 *       404:
 *         description: Not found, not published, or not yours
 */
router.get("/me/:id", protect, authorize("client"), reportIdRule, validate, getMyReport);

/**
 * @swagger
 * /reports/{id}:
 *   get:
 *     summary: Get one report with all its sections
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Report fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReportWithPrevious'
 *       404:
 *         description: Not found, or belongs to a client you can't see
 *   patch:
 *     summary: Edit a report
 *     description: >
 *       Send only what changes: figures are merged one by one (null clears one), lists (blogs, gmb.locations)
 *       are replaced whole. The client cannot be changed. A writer can edit a draft only; managers, admins and
 *       superadmins can edit at any stage.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ReportContent'
 *               - type: object
 *                 properties:
 *                   periodType: { type: string, enum: [weekly, monthly] }
 *                   periodStart: { type: string, format: date }
 *                   periodEnd: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Report updated successfully
 *       403:
 *         description: Report is past draft and you are not a reviewer
 *       404:
 *         description: Report not found
 *       409:
 *         description: Another report already covers this period
 *       422:
 *         description: Validation failed
 *   delete:
 *     summary: Delete a report
 *     description: Roles admin, superadmin. Recorded in the audit log.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Report deleted successfully
 *       404:
 *         description: Report not found
 */
router.get("/:id", protect, authorize(...REPORT_READ_ROLES), reportIdRule, validate, getReport);
router.patch("/:id", protect, authorize(...REPORT_WRITE_ROLES), reportIdRule, updateReportRules, validate, updateReport);
router.delete("/:id", protect, authorize(...REPORT_DELETE_ROLES), reportIdRule, validate, deleteReport);

/**
 * @swagger
 * /reports/{id}/status:
 *   patch:
 *     summary: Move a report through review
 *     description: >
 *       Writers can hand a draft in (draft → submitted). Managers, admins and superadmins can also approve,
 *       publish (skipping steps is fine) or send any report back to draft, which clears the later steps.
 *       A report needs a summary or some figures before it can leave draft. Publishing makes it visible to the client.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [draft, submitted, approved, published] }
 *     responses:
 *       200:
 *         description: Report status changed
 *       400:
 *         description: Already in that status, or a move that isn't allowed
 *       403:
 *         description: Your role cannot make this move
 *       404:
 *         description: Report not found
 *       422:
 *         description: The report is empty
 */
router.patch("/:id/status", protect, authorize(...REPORT_WRITE_ROLES), reportIdRule, changeStatusRules, validate, changeReportStatus);

export default router;
