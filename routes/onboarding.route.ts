import { Router } from "express";
import {
  deleteOnboarding,
  getMyOnboarding,
  getOnboarding,
  getOnboardingRequest,
  listOnboardingRequests,
  removeMyOnboardingMedia,
  startOnboarding,
  updateMyOnboarding,
  updateOnboarding,
  uploadMyOnboardingMedia,
} from "../controllers/onboarding.controller";
import { onboardingMediaUpload } from "../middleware/upload";
import { protect, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import type { UserRole } from "../models/user.model";
import {
  listOnboardingRequestsRules,
  onboardingIdRule,
  onboardingKeyRule,
  onboardingMediaKindRule,
  removeOnboardingMediaRules,
  startOnboardingRules,
  updateOnboardingRules,
} from "../validators/onboarding.validator";

const router = Router();

// Who on the team sees the onboardings that come in: the roles that manage clients. (A new
// onboarding has no account manager or team yet, so it can't be shown by assignment.)
const CAN_MANAGE: UserRole[] = ["assistant_manager", "manager", "admin", "superadmin"];

/**
 * @swagger
 * tags:
 *   name: Onboarding
 *   description: >
 *     The onboarding form, for someone with no account yet. These routes need no sign-in.
 *     Starting onboarding creates a client with status "pending" and returns a `key`, once;
 *     reading, changing or deleting that onboarding needs the key in the `x-onboarding-key`
 *     header. The key stops working once the team takes the client on (its status is no
 *     longer "pending"). Files can't be attached through these routes.
 * components:
 *   parameters:
 *     OnboardingKey:
 *       in: header
 *       name: x-onboarding-key
 *       required: true
 *       schema: { type: string }
 *       description: The key returned when onboarding was started
 *   schemas:
 *     OnboardingAnswers:
 *       type: object
 *       properties:
 *         answers:
 *           type: object
 *           description: >
 *             Any of the form's sections, shaped as in ClientOnboarding. A section that is sent
 *             replaces what was stored for it; one left out is untouched. (`answers.email` is
 *             the business-email section — not the contact's email, which sits beside `answers`.)
 *           properties:
 *             website: { type: object }
 *             domain: { type: object }
 *             hosting: { type: object }
 *             cms: { type: object }
 *             email: { type: object }
 *             logo: { type: object }
 *             google: { type: object }
 *             social: { type: object }
 *             media: { type: object }
 *         submit: { type: boolean, description: "true hands the onboarding in; false takes it back to in progress" }
 *     OnboardingView:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         contactName: { type: string }
 *         companyName: { type: string }
 *         email: { type: string }
 *         phone: { type: string }
 *         onboarding: { $ref: '#/components/schemas/ClientOnboarding' }
 */

/**
 * @swagger
 * /onboarding:
 *   post:
 *     summary: Start onboarding (no sign-in)
 *     tags: [Onboarding]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - type: object
 *                 required: [contactName, companyName, email]
 *                 properties:
 *                   contactName: { type: string, example: Sarah Carter }
 *                   companyName: { type: string, example: Carter Injury Law }
 *                   email: { type: string, example: sarah@carterinjurylaw.com }
 *                   phone: { type: string, example: "+18137065778" }
 *               - $ref: '#/components/schemas/OnboardingAnswers'
 *     responses:
 *       201:
 *         description: Saved. `data.key` is shown this once — keep it to come back to these answers.
 *       409:
 *         description: The email already has an account
 *       422:
 *         description: Validation failed
 */
router.post("/", startOnboardingRules, validate, startOnboarding);

/**
 * @swagger
 * /onboarding/requests:
 *   get:
 *     summary: List the onboardings waiting to be taken on (staff)
 *     description: >
 *       Roles: assistant_manager, manager, admin, superadmin. Clients still "pending" that came
 *       in through the onboarding form — those handed in first, then the ones still being
 *       filled in. Headline fields only; the answers come with the single request.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [in_progress, submitted] } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: "`requests`, `summary` (total, submitted, in_progress) and `pagination`"
 * /onboarding/requests/{id}:
 *   get:
 *     summary: One onboarding in full (staff)
 *     description: "Roles: assistant_manager, manager, admin, superadmin. Who sent it and every answer."
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string }, description: The client's id }
 *     responses:
 *       200:
 *         description: The client's contact details and its `onboarding`
 *       404:
 *         description: No onboarding for this id
 * /onboarding/{id}:
 *   get:
 *     summary: Read an onboarding's answers (needs its key)
 *     tags: [Onboarding]
 *     security: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - $ref: '#/components/parameters/OnboardingKey'
 *     responses:
 *       200:
 *         description: The answers so far
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/OnboardingView' }
 *       404:
 *         description: No onboarding for this id and key
 *       409:
 *         description: The team has already taken this client on
 *   patch:
 *     summary: Change an onboarding's answers (needs its key)
 *     tags: [Onboarding]
 *     security: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - $ref: '#/components/parameters/OnboardingKey'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - type: object
 *                 properties:
 *                   contactName: { type: string }
 *                   companyName: { type: string }
 *                   phone: { type: string }
 *               - $ref: '#/components/schemas/OnboardingAnswers'
 *     responses:
 *       200:
 *         description: Saved
 *       404:
 *         description: No onboarding for this id and key
 *       409:
 *         description: The team has already taken this client on
 *       422:
 *         description: Validation failed
 *   delete:
 *     summary: Withdraw an onboarding (needs its key)
 *     tags: [Onboarding]
 *     security: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - $ref: '#/components/parameters/OnboardingKey'
 *     responses:
 *       200:
 *         description: Deleted, along with the pending client record it made
 *       404:
 *         description: No onboarding for this id and key
 *       409:
 *         description: The team has already taken this client on
 */
// Before "/:id", which would otherwise take "requests" for an id.
router.get("/requests", protect, authorize(...CAN_MANAGE), listOnboardingRequestsRules, validate, listOnboardingRequests);
router.get("/requests/:id", protect, authorize(...CAN_MANAGE), onboardingIdRule, validate, getOnboardingRequest);

/**
 * @swagger
 * /onboarding/me:
 *   get:
 *     summary: The signed-in client's own onboarding
 *     description: For a client with an account. Who they are (name, company, email, phone) and their answers so far, to fill the form with. No key is needed — their login says whose record it is.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The client's details and answers
 *       404:
 *         description: This account has no client record
 *   patch:
 *     summary: Save the signed-in client's own onboarding
 *     description: Same body as PATCH /onboarding/{id}. Their name, company and phone are kept in step with their login.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Saved
 *       409:
 *         description: The phone number belongs to another account
 *       422:
 *         description: Validation failed
 */
// Also before "/:id", which would otherwise take "me" for an id.
router.get("/me", protect, authorize("client"), getMyOnboarding);
router.patch("/me", protect, authorize("client"), updateOnboardingRules, validate, updateMyOnboarding);

/**
 * @swagger
 * /onboarding/me/media/{kind}:
 *   post:
 *     summary: Upload photos or videos for the signed-in client's onboarding
 *     description: A multipart form with the files under `files` (up to 10 at a time). `kind` is professionalPhotos, businessPhotos (JPG, PNG, WEBP or GIF, up to 10MB each) or videos (MP4, MOV or WEBM, up to 200MB each). The files go to DigitalOcean Spaces and are listed on the client's record.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: The files now stored for that kind
 *       422:
 *         description: A file of the wrong type or size, or too many files
 *   delete:
 *     summary: Remove one uploaded photo or video
 *     description: Send the file's `url` in the body. It is taken off the record and out of Spaces.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The files left for that kind
 *       404:
 *         description: No such file on this client's onboarding
 */
router.post("/me/media/:kind", protect, authorize("client"), onboardingMediaKindRule, validate, onboardingMediaUpload, uploadMyOnboardingMedia);
router.delete("/me/media/:kind", protect, authorize("client"), onboardingMediaKindRule, removeOnboardingMediaRules, validate, removeMyOnboardingMedia);

router.get("/:id", onboardingIdRule, onboardingKeyRule, validate, getOnboarding);
router.patch("/:id", onboardingIdRule, onboardingKeyRule, updateOnboardingRules, validate, updateOnboarding);
router.delete("/:id", onboardingIdRule, onboardingKeyRule, validate, deleteOnboarding);

export default router;
