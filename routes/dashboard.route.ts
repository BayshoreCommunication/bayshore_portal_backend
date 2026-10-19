import { Router } from "express";
import { getOverview } from "../controllers/dashboard.controller";
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

export default router;
