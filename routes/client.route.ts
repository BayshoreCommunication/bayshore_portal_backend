import { Router } from "express";
import {
  createClient,
  listClients,
  getClient,
  updateClient,
  deleteClient,
} from "../controllers/client.controller";
import { protect, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { USER_ROLES, type UserRole } from "../models/user.model";
import {
  clientIdRule,
  createClientRules,
  updateClientRules,
  listClientsRules,
} from "../validators/client.validator";

const router = Router();

const STAFF_ROLES = USER_ROLES.filter((role) => role !== "client") as UserRole[];
const CAN_MANAGE: UserRole[] = ["assistant_manager", "manager", "admin", "superadmin"];
const CAN_DELETE: UserRole[] = ["admin", "superadmin"];

/**
 * @swagger
 * tags:
 *   name: Clients
 *   description: >
 *     Client companies. Creating a client also creates its login account (role "client").
 *     Admins and superadmins see every client; other staff only see clients they own, are assigned to, or created.
 */

/**
 * @swagger
 * /clients:
 *   post:
 *     summary: Create a client together with its login account
 *     description: >
 *       Saves the client and creates a User with role "client", filled in from the client's name, company,
 *       email, phone and address, with the password that is sent. Allowed roles: assistant_manager, manager, admin, superadmin.
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contactName
 *               - companyName
 *               - email
 *               - serviceTypes
 *               - startDate
 *               - password
 *             properties:
 *               contactName:
 *                 type: string
 *                 example: Sarah Carter
 *               companyName:
 *                 type: string
 *                 example: Carter Injury Law
 *               email:
 *                 type: string
 *                 example: client@company.com
 *               phone:
 *                 type: string
 *                 example: "+19876543210"
 *               address:
 *                 type: string
 *               serviceTypes:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: string
 *                 example: [SEO, Social Media]
 *               startDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-10-01"
 *               status:
 *                 type: string
 *                 enum: [pending, active, on_hold, closed]
 *                 default: active
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *               accountManager:
 *                 type: string
 *                 description: Staff user id
 *               team:
 *                 type: array
 *                 items:
 *                   type: string
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 maxLength: 72
 *                 description: Password the client signs in to the client portal with
 *     responses:
 *       201:
 *         description: Client created successfully
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
 *                     client:
 *                       $ref: '#/components/schemas/Client'
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Role not allowed
 *       409:
 *         description: Email or phone already registered
 *       422:
 *         description: Validation failed
 *   get:
 *     summary: List clients
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search company name, contact name or email
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, active, on_hold, closed]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Clients fetched successfully
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
 *                     clients:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Client'
 *                     summary:
 *                       type: object
 *                       description: Counts across every client the caller can see, ignoring the search and status filter
 *                       properties:
 *                         total:
 *                           type: integer
 *                         pending:
 *                           type: integer
 *                         active:
 *                           type: integer
 *                         on_hold:
 *                           type: integer
 *                         closed:
 *                           type: integer
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
 *       403:
 *         description: Clients cannot use this endpoint
 */
router.post("/", protect, authorize(...CAN_MANAGE), createClientRules, validate, createClient);
router.get("/", protect, authorize(...STAFF_ROLES), listClientsRules, validate, listClients);

/**
 * @swagger
 * /clients/{id}:
 *   get:
 *     summary: Get one client
 *     description: Includes the account manager, assigned team and the client's login account.
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Client fetched successfully
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
 *                   $ref: '#/components/schemas/Client'
 *       404:
 *         description: Client not found, or not visible to you
 *   patch:
 *     summary: Update a client
 *     description: >
 *       The login account follows the client's name, company, email, phone and address.
 *       Changing status also updates every login of this client (active → can sign in;
 *       pending, on_hold, closed → cannot).
 *       Allowed roles: assistant_manager, manager, admin, superadmin.
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contactName:
 *                 type: string
 *               companyName:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               serviceTypes:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: string
 *               startDate:
 *                 type: string
 *                 format: date
 *               status:
 *                 type: string
 *                 enum: [pending, active, on_hold, closed]
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *               accountManager:
 *                 type: string
 *                 nullable: true
 *               team:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Client updated successfully
 *       404:
 *         description: Client not found, or not visible to you
 *       409:
 *         description: Email or phone already registered
 *       422:
 *         description: Validation failed
 *   delete:
 *     summary: Delete a client and all of its login accounts
 *     description: Allowed roles: admin, superadmin. Its sessions are revoked and the deletion is recorded in the audit log.
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Client deleted successfully
 *       404:
 *         description: Client not found
 */
router.get("/:id", protect, authorize(...STAFF_ROLES), clientIdRule, validate, getClient);
router.patch("/:id", protect, authorize(...CAN_MANAGE), clientIdRule, updateClientRules, validate, updateClient);
router.delete("/:id", protect, authorize(...CAN_DELETE), clientIdRule, validate, deleteClient);

export default router;
