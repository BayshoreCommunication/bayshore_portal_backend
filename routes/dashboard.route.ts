import { Router } from "express";
import { getMyDashboard, getOverview } from "../controllers/dashboard.controller";
import { protect, authorize } from "../middleware/auth";
import { USER_ROLES, type UserRole } from "../models/user.model";

const router = Router();

const STAFF_ROLES = USER_ROLES.filter((role) => role !== "client") as UserRole[];

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: The staff dashboard in company-portal, over the clients the caller can see.
 */

/**
 * @swagger
 * /dashboard/overview:
 *   get:
 *     summary: The staff dashboard
 *     description: >
 *       Headline figures for this month (compared with the same point last month), twelve months of revenue and
 *       new clients, who still owes what, work waiting on the team and upcoming meetings. Months are UTC calendar months.
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard fetched successfully
 */
router.get("/overview", protect, authorize(...STAFF_ROLES), getOverview);

/**
 * @swagger
 * /dashboard/me:
 *   get:
 *     summary: The client portal's dashboard, in one call
 *     description: >
 *       The signed-in client's published reports (newest first, with figures), the leads they
 *       collected this month against the same stretch of last month, the content waiting on their
 *       decision, and their meetings in the next 60 days.
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard fetched
 */
router.get("/me", protect, authorize("client"), getMyDashboard);

export default router;
