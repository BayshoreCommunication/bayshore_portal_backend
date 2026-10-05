import { Router } from "express";
import {
  createLead,
  listLeads,
  getLead,
  updateLead,
  deleteLead,
  listMyLeads,
  getMyLead,
} from "../controllers/lead.controller";
import { protect, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  leadIdRule,
  createLeadRules,
  updateLeadRules,
  listLeadsRules,
  listMyLeadsRules,
} from "../validators/lead.validator";
import { LEAD_READ_ROLES, LEAD_WRITE_ROLES, LEAD_DELETE_ROLES } from "../utils/leadAccess";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Leads
 *   description: >
 *     Inquiries captured for a client. Staff add, edit and delete them from the company portal
 *     and see the leads of clients they own, are assigned to, or created (admins see all).
 *     Clients read their own leads from the client portal and can't change them.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     LeadInput:
 *       type: object
 *       description: The fields staff can set. Send only what you want to change when editing; null or "" clears an optional field.
 *       properties:
 *         fullName: { type: string, maxLength: 120 }
 *         phone: { type: string, description: 'Formatting is stripped: "+1 (987) 654-3210" becomes "+19876543210"' }
 *         email: { type: string }
 *         caseType: { type: string, maxLength: 100, description: Typed in; each firm uses its own }
 *         source:
 *           type: string
 *           enum: [gmb_call, gmb_message, website_form, website_chat, blog_cta, facebook, instagram, referral, walk_in, office_call, other]
 *         receivedAt: { type: string, format: date-time, description: Defaults to now; can't be in the future }
 *         status:
 *           type: string
 *           enum: [new, contacted, qualified, consultation_set, converted, lost]
 *         consultationAt: { type: string, format: date-time, description: Required when status is consultation_set }
 *         lostReason: { type: string, description: Required when status is lost }
 *         notes: { type: string, maxLength: 500, description: Visible to the client }
 *         internalNotes: { type: string, maxLength: 500, description: Team-only }
 *     LeadCounts:
 *       type: object
 *       properties:
 *         summary:
 *           type: object
 *           description: Leads per status for the client and date range, ignoring the other filters
 *           properties:
 *             total: { type: integer }
 *             new: { type: integer }
 *             contacted: { type: integer }
 *             qualified: { type: integer }
 *             consultation_set: { type: integer }
 *             converted: { type: integer }
 *             lost: { type: integer }
 *         channels:
 *           type: object
 *           description: Leads per channel for the client and date range, ignoring the other filters
 *           properties:
 *             gmb: { type: integer }
 *             website: { type: integer }
 *             social: { type: integer }
 *             referral: { type: integer }
 *             direct: { type: integer }
 *         caseTypes:
 *           type: array
 *           description: The case types in use for the client and date range, A–Z — for a filter or suggestions
 *           items: { type: string }
 */

/**
 * @swagger
 * /leads:
 *   post:
 *     summary: Add a lead
 *     description: >
 *       Roles: employee, executive, assistant_manager, manager, admin, superadmin — for clients they can see.
 *       A phone number or an email is required. Starts as "new" unless a status is given.
 *     tags: [Leads]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/LeadInput'
 *               - type: object
 *                 required: [client, fullName, caseType, source]
 *                 properties:
 *                   client: { type: string, description: Client id }
 *     responses:
 *       201:
 *         description: Lead created successfully
 *       404:
 *         description: Client not found, or not one of your clients
 *       422:
 *         description: Validation failed
 *   get:
 *     summary: List leads
 *     description: Newest first, with counts per status and per channel for the tiles and the source chart.
 *     tags: [Leads]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: client, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [new, contacted, qualified, consultation_set, converted, lost] } }
 *       - { in: query, name: channel, schema: { type: string, enum: [gmb, website, social, referral, direct] } }
 *       - { in: query, name: source, schema: { type: string } }
 *       - { in: query, name: caseType, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date }, description: Received on or after }
 *       - { in: query, name: to, schema: { type: string, format: date }, description: Received on or before (a bare date covers that whole day) }
 *       - { in: query, name: q, schema: { type: string }, description: Search name or email or phone or case type }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Leads fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/LeadCounts'
 *                     - type: object
 *                       properties:
 *                         leads:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/Lead'
 *                         pagination:
 *                           type: object
 *                           properties:
 *                             page: { type: integer }
 *                             limit: { type: integer }
 *                             total: { type: integer }
 *                             totalPages: { type: integer }
 */
router.post("/", protect, authorize(...LEAD_WRITE_ROLES), createLeadRules, validate, createLead);
router.get("/", protect, authorize(...LEAD_READ_ROLES), listLeadsRules, validate, listLeads);

/**
 * @swagger
 * /leads/me:
 *   get:
 *     summary: The signed-in client's leads
 *     description: For the client portal. Read-only, the caller's own company only, without team-only details (internalNotes, createdBy, origin).
 *     tags: [Leads]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [new, contacted, qualified, consultation_set, converted, lost] } }
 *       - { in: query, name: channel, schema: { type: string, enum: [gmb, website, social, referral, direct] } }
 *       - { in: query, name: caseType, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Leads fetched successfully, with the same counts as GET /leads
 *       403:
 *         description: Not a client account
 */
router.get("/me", protect, authorize("client"), listMyLeadsRules, validate, listMyLeads);

/**
 * @swagger
 * /leads/me/{id}:
 *   get:
 *     summary: One of the signed-in client's leads
 *     description: Includes the status timeline, without who on staff made each change.
 *     tags: [Leads]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Lead fetched successfully
 *       404:
 *         description: Not found, or not yours
 */
router.get("/me/:id", protect, authorize("client"), leadIdRule, validate, getMyLead);

/**
 * @swagger
 * /leads/{id}:
 *   get:
 *     summary: Get one lead with its status timeline and internal notes
 *     tags: [Leads]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Lead fetched successfully
 *       404:
 *         description: Not found, or belongs to a client you can't see
 *   patch:
 *     summary: Edit a lead
 *     description: >
 *       Send only what changes. Changing the status adds it to the timeline. The client can't be changed.
 *     tags: [Leads]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LeadInput'
 *     responses:
 *       200:
 *         description: Lead updated successfully
 *       404:
 *         description: Lead not found
 *       422:
 *         description: Validation failed
 *   delete:
 *     summary: Delete a lead
 *     description: Roles manager, admin, superadmin. Recorded in the audit log.
 *     tags: [Leads]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Lead deleted successfully
 *       404:
 *         description: Lead not found
 */
router.get("/:id", protect, authorize(...LEAD_READ_ROLES), leadIdRule, validate, getLead);
router.patch("/:id", protect, authorize(...LEAD_WRITE_ROLES), leadIdRule, updateLeadRules, validate, updateLead);
router.delete("/:id", protect, authorize(...LEAD_DELETE_ROLES), leadIdRule, validate, deleteLead);

export default router;
