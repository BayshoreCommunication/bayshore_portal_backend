import { Router } from "express";
import {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
  getClientServices,
  setClientServices,
  listMyServices,
  listCatalogForClient,
} from "../controllers/service.controller";
import { createServiceCheckout, getMyServiceOrder } from "../controllers/payment.controller";
import { protect, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  serviceIdRule,
  serviceClientIdRule,
  createServiceRules,
  updateServiceRules,
  setClientServicesRules,
  addMyServicesRules,
  serviceOrderSessionRule,
} from "../validators/service.validator";
import { SERVICE_READ_ROLES, SERVICE_MANAGE_ROLES, SERVICE_ASSIGN_ROLES } from "../utils/serviceAccess";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Services
 *   description: >
 *     The catalog of services BayShore offers (main services made of priced sub-services), and which
 *     of them each client takes. Only a superadmin adds, edits or deletes catalog services. Staff choose
 *     which services a client takes, for the clients they can see. A client's monthly payment is the sum
 *     of what their services cost. Clients read their own services from the client portal, and can pay
 *     (through Stripe Checkout) to add more.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ServiceInput:
 *       type: object
 *       properties:
 *         title: { type: string, maxLength: 80 }
 *         description: { type: string, maxLength: 200 }
 *         plan: { type: string, enum: [growth, core] }
 *         color: { type: string, example: "#c8973a" }
 *         subServices:
 *           type: array
 *           minItems: 1
 *           description: >
 *             The whole list. When editing: an item with its _id is the same sub-service renamed or re-priced;
 *             one without an _id is new; one left out is removed.
 *           items:
 *             type: object
 *             required: [name, price]
 *             properties:
 *               _id: { type: string, description: Editing only }
 *               name: { type: string, maxLength: 100 }
 *               price: { type: integer, minimum: 0, description: Whole dollars a month }
 *     ClientServices:
 *       type: object
 *       properties:
 *         success: { type: boolean }
 *         message: { type: string }
 *         data:
 *           type: object
 *           properties:
 *             services:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ClientService'
 *             monthlyTotal: { type: integer, description: The client's monthly payment. The sum of their services. }
 */

/**
 * @swagger
 * /services:
 *   get:
 *     summary: The service catalog
 *     description: >
 *       Every service, with how many of your clients take each one (clientCount) and what they pay for it
 *       a month (monthlyRevenue), plus totals for the tiles.
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Services fetched successfully
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
 *                     services:
 *                       type: array
 *                       items:
 *                         allOf:
 *                           - $ref: '#/components/schemas/Service'
 *                           - type: object
 *                             properties:
 *                               clientCount: { type: integer }
 *                               monthlyRevenue: { type: integer }
 *                     summary:
 *                       type: object
 *                       properties:
 *                         services: { type: integer }
 *                         subServices: { type: integer }
 *                         clientsServed: { type: integer }
 *                         monthlyTotal: { type: integer, description: What all your clients pay a month together }
 *   post:
 *     summary: Add a service to the catalog
 *     description: Superadmin only. The service's monthly price is the sum of its sub-services' prices.
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ServiceInput'
 *               - type: object
 *                 required: [title, subServices]
 *     responses:
 *       201:
 *         description: Service created successfully
 *       403:
 *         description: Not a superadmin
 *       409:
 *         description: The catalog already has a service with that name
 *       422:
 *         description: Validation failed
 */
router.get("/", protect, authorize(...SERVICE_READ_ROLES), listServices);
router.post("/", protect, authorize(...SERVICE_MANAGE_ROLES), createServiceRules, validate, createService);

/**
 * @swagger
 * /services/me:
 *   get:
 *     summary: The signed-in client's services and monthly payment
 *     description: For the client portal. Read-only. Only what the client takes, with each included sub-service and its price.
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Services fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClientServices'
 *       403:
 *         description: Not a client account
 */
router.get("/me", protect, authorize("client"), listMyServices);

/**
 * @swagger
 * /services/me/catalog:
 *   get:
 *     summary: The service catalog, for a client to browse
 *     description: Every service with its sub-services and prices. Without how many other clients take each one.
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Services fetched successfully
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
 *                     services:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Service'
 */
router.get("/me/catalog", protect, authorize("client"), listCatalogForClient);

/**
 * @swagger
 * /services/me/checkout:
 *   post:
 *     summary: Pay for more services
 *     description: >
 *       The signed-in client chooses catalog services (or more sub-services of ones they have). This writes a
 *       pending order and returns a Stripe Checkout URL to send the client to. What's due is the first month of
 *       what's being added. The services are added to the client once Stripe confirms the payment (by webhook),
 *       never before. It only adds: nothing the client already takes is removed.
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [services]
 *             properties:
 *               services:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [service, subServices]
 *                   properties:
 *                     service: { type: string, description: Catalog service id }
 *                     subServices:
 *                       type: array
 *                       minItems: 1
 *                       description: Ids of the sub-services to add
 *                       items: { type: string }
 *     responses:
 *       201:
 *         description: Checkout started. Send the client to data.url. It is null when nothing was due and the services were added straight away.
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
 *                     url: { type: string, nullable: true, description: Stripe Checkout page }
 *                     order:
 *                       $ref: '#/components/schemas/ServiceOrder'
 *       422:
 *         description: Validation failed, the client already has everything chosen, or something is no longer in the catalog
 *       502:
 *         description: Stripe could not start the payment
 *       503:
 *         description: Payments are not configured
 */
router.post("/me/checkout", protect, authorize("client"), addMyServicesRules, validate, createServiceCheckout);

/**
 * @swagger
 * /services/me/orders/{sessionId}:
 *   get:
 *     summary: How an order went
 *     description: >
 *       For the page a client lands on after Stripe Checkout. Looks the order up by its Stripe session id.
 *       A still-pending order is checked against Stripe on the spot, so a paid order shows as paid (and its
 *       services are added) even if the webhook has not arrived yet.
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: sessionId, required: true, schema: { type: string }, description: Stripe Checkout session id }
 *     responses:
 *       200:
 *         description: Order fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/ServiceOrder'
 *                     - type: object
 *                       properties:
 *                         monthlyTotal: { type: integer, description: The client's monthly payment as it stands now }
 *       404:
 *         description: Order not found, or not yours
 */
router.get("/me/orders/:sessionId", protect, authorize("client"), serviceOrderSessionRule, validate, getMyServiceOrder);

/**
 * @swagger
 * /services/clients/{clientId}:
 *   get:
 *     summary: The services a client takes and their monthly payment
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: clientId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Client services fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClientServices'
 *       404:
 *         description: Client not found, or not one of your clients
 *   put:
 *     summary: Set the services a client takes
 *     description: >
 *       Roles: employee, executive, assistant_manager, manager, admin, superadmin — for clients they can see.
 *       Replaces the client's whole set: services left out are removed, and an empty list removes them all.
 *       Prices come from the catalog.
 *     tags: [Services]
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
 *             required: [services]
 *             properties:
 *               services:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [service, subServices]
 *                   properties:
 *                     service: { type: string, description: Catalog service id }
 *                     subServices:
 *                       type: array
 *                       minItems: 1
 *                       description: Ids of the sub-services the client takes
 *                       items: { type: string }
 *     responses:
 *       200:
 *         description: Client services saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClientServices'
 *       404:
 *         description: Client not found, or not one of your clients
 *       422:
 *         description: Validation failed, or a service or sub-service is no longer in the catalog
 */
router.get("/clients/:clientId", protect, authorize(...SERVICE_READ_ROLES), serviceClientIdRule, validate, getClientServices);
router.put(
  "/clients/:clientId",
  protect,
  authorize(...SERVICE_ASSIGN_ROLES),
  serviceClientIdRule,
  setClientServicesRules,
  validate,
  setClientServices
);

/**
 * @swagger
 * /services/{id}:
 *   get:
 *     summary: Get one catalog service
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Service fetched successfully
 *       404:
 *         description: Service not found
 *   patch:
 *     summary: Edit a catalog service
 *     description: >
 *       Superadmin only. Send only what changes. Clients who take the service are brought along: a renamed or
 *       re-priced sub-service is updated for them (so their monthly payment changes), a removed one is dropped,
 *       and a client left with none of its sub-services no longer has the service. The response says how many
 *       clients were updated and how many lost the service.
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ServiceInput'
 *     responses:
 *       200:
 *         description: Service updated successfully
 *       403:
 *         description: Not a superadmin
 *       404:
 *         description: Service not found
 *       409:
 *         description: Another service already has that name
 *       422:
 *         description: Validation failed
 *   delete:
 *     summary: Delete a catalog service
 *     description: Superadmin only. Refused while any client still takes the service.
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Service deleted successfully
 *       403:
 *         description: Not a superadmin
 *       404:
 *         description: Service not found
 *       409:
 *         description: Clients still take this service
 */
router.get("/:id", protect, authorize(...SERVICE_READ_ROLES), serviceIdRule, validate, getService);
router.patch("/:id", protect, authorize(...SERVICE_MANAGE_ROLES), serviceIdRule, updateServiceRules, validate, updateService);
router.delete("/:id", protect, authorize(...SERVICE_MANAGE_ROLES), serviceIdRule, validate, deleteService);

export default router;
