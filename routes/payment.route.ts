import { Router } from "express";
import { listPayments } from "../controllers/payment.controller";
import { protect, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { listPaymentsRules } from "../validators/payment.validator";
import { PAYMENT_READ_ROLES } from "../utils/paymentAccess";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: >
 *     What clients have paid through Stripe to add services. Clients start a payment from the client portal
 *     (POST /services/me/checkout); Stripe confirms it to POST /payments/stripe/webhook, which marks the order
 *     paid and adds the services. Staff read the payments of the clients they can see.
 */

/**
 * @swagger
 * /payments:
 *   get:
 *     summary: List payments
 *     description: >
 *       Every order clients have placed for more services, newest first, with counts and money per status and
 *       the clients who paid the most. The summary covers the client and date range only, not the status or search.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: client, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [pending, paid, expired, failed] } }
 *       - { in: query, name: from, schema: { type: string, format: date }, description: Placed on or after }
 *       - { in: query, name: to, schema: { type: string, format: date }, description: Placed on or before (a bare date covers that whole day) }
 *       - { in: query, name: q, schema: { type: string }, description: Search the client's company name or a service in the order }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Payments fetched successfully
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
 *                     payments:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ServiceOrder'
 *                     summary:
 *                       type: object
 *                       properties:
 *                         total: { type: integer }
 *                         pending: { type: integer }
 *                         paid: { type: integer }
 *                         expired: { type: integer }
 *                         failed: { type: integer }
 *                         collected: { type: integer, description: Whole dollars actually paid }
 *                         pendingAmount: { type: integer, description: Whole dollars still waiting on Stripe }
 *                     topClients:
 *                       type: array
 *                       description: Up to five clients who paid the most in the range
 *                       items:
 *                         type: object
 *                         properties:
 *                           client: { type: string }
 *                           companyName: { type: string }
 *                           amount: { type: integer }
 *                           count: { type: integer }
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *                         totalPages: { type: integer }
 */
router.get("/", protect, authorize(...PAYMENT_READ_ROLES), listPaymentsRules, validate, listPayments);

/**
 * @swagger
 * /payments/stripe/webhook:
 *   post:
 *     summary: Stripe's webhook
 *     description: >
 *       Called by Stripe, not by the portals. Checks the Stripe-Signature header against STRIPE_WEBHOOK_SECRET,
 *       then for checkout.session.completed / async_payment_succeeded marks the order paid and adds its services
 *       to the client; for async_payment_failed and expired marks it failed or expired. Safe to receive twice.
 *     tags: [Payments]
 *     responses:
 *       200:
 *         description: Received
 *       400:
 *         description: The signature did not match
 *       503:
 *         description: The webhook secret is not configured
 */

export default router;
