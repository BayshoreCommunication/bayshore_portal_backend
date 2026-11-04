import { Router } from "express";
import {
  deleteOnboarding,
  getMyOnboarding,
  getOnboarding,
  getOnboardingRequest,
  listOnboardingRequests,
  removeMyOnboardingMedia,
  updateClientOnboarding,
  addClientCustomAccount,
  removeClientCustomAccount,
  revealClientOnboardingPassword,
  uploadClientOnboardingMedia,
  removeClientOnboardingMedia,
  startOnboarding,
  updateMyOnboarding,
  updateOnboarding,
  uploadMyOnboardingMedia,
} from "../controllers/onboarding.controller";
import { bookMyCall, getMyBooking } from "../controllers/booking.controller";
import { body } from "express-validator";
import { addMyOnboardingComment, addOnboardingComment, listMyOnboardingComments, listOnboardingComments, replyToOnboardingComment } from "../controllers/onboardingComment.controller";
import { commentUpload, onboardingMediaUpload } from "../middleware/upload";
import { protect, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { USER_ROLES, type UserRole } from "../models/user.model";
import {
  addCustomAccountRules,
  removeCustomAccountRules,
  addOnboardingCommentRules,
  answerRules,
  listOnboardingRequestsRules,
  onboardingCommentsClientRule,
  replyOnboardingCommentRules,
  onboardingIdRule,
  onboardingKeyRule,
  onboardingMediaKindRule,
  removeOnboardingMediaRules,
  startOnboardingRules,
  updateOnboardingRules,
} from "../validators/onboarding.validator";

const router = Router();

// Everyone on the team: who may reply is decided by who can see the client (utils/clientAccess).
const STAFF_ROLES = USER_ROLES.filter((role) => role !== "client") as UserRole[];

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
 *     description: A multipart form with the files under `files` (up to 10 at a time). `kind` is professionalPhotos, businessPhotos (JPG, PNG, WEBP or GIF, up to 10MB each) or videos (MP4, MOV or WEBM, up to 200MB each) — or logo, or logoStyle for what shows the style of a logo to be designed (PNG, JPG, WEBP, GIF or SVG, up to 10MB each). The files go to DigitalOcean Spaces and are listed on the client's record.
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

/**
 * @swagger
 * /onboarding/me/comments:
 *   get:
 *     summary: The signed-in client's comments on their onboarding form, with the team's replies
 *     description: Oldest first. Each has its `step` (contact, web, domain, email, logo, google, social or media), its text and files, and `replies` from the team.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The comments
 *   post:
 *     summary: Comment on a step of the signed-in client's onboarding form
 *     description: A multipart form with `step`, `text` (up to 1000 characters) and files under `files` (up to 5; images, videos or documents). Text, files, or both.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: The comment
 *       422:
 *         description: No step, no text and no file, or a file of the wrong type or size
 */
/**
 * @swagger
 * /onboarding/me/booking:
 *   get:
 *     summary: Free times for the signed-in client's onboarding call
 *     description: >
 *       From the booking calendar the team chose on the company portal's Calendar page.
 *       `available` is false when there is none — book on the Google booking page then.
 *       `booked` is the call already booked, if any.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ available, booked, duration, host, slots: ISO times }"
 *   post:
 *     summary: Book (or move) the signed-in client's onboarding call
 *     description: Adds it to the booking calendar with a Google Meet link; Google emails the client the invitation.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [start]
 *             properties:
 *               start:
 *                 type: string
 *                 format: date-time
 *                 description: One of the free times
 *     responses:
 *       200:
 *         description: "{ callAt, meetLink }"
 *       409:
 *         description: That time is no longer free, or online booking isn't open
 */
router.get("/me/booking", protect, authorize("client"), getMyBooking);
router.post("/me/booking", protect, authorize("client"), [body("start").isISO8601().withMessage("Pick a time")], validate, bookMyCall);
router.get("/me/comments", protect, authorize("client"), listMyOnboardingComments);
router.post("/me/comments", protect, authorize("client"), commentUpload, addOnboardingCommentRules, validate, addMyOnboardingComment);

/**
 * @swagger
 * /onboarding/clients/{clientId}/comments:
 *   get:
 *     summary: Staff — a client's comments on their onboarding form, with the replies
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The comments
 *       404:
 *         description: No such client, or one the caller can't see
 *   post:
 *     summary: Staff — comment on a step of a client's onboarding form
 *     description: A multipart form with `step`, `text` (up to 1000 characters) and files under `files` (up to 5). The client sees it on that step of their form, from the team.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: The comment
 *       404:
 *         description: No such client, or one the caller can't see
 * /onboarding/clients/{clientId}/comments/{commentId}/replies:
 *   post:
 *     summary: Staff — reply to a client's comment on their onboarding form
 *     description: A multipart form with `text` (up to 1000 characters) and files under `files` (up to 5). Text, files, or both.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: The comment, with the reply under it
 *       404:
 *         description: No such client or comment
 */
/**
 * @swagger
 * /onboarding/clients/{clientId}:
 *   patch:
 *     summary: Staff — fill in or correct a client's onboarding answers
 *     description: The same `answers` sections as the client's own form. A section sent replaces the one stored; one left out is untouched. A stored password is kept unless a new `loginPassword` is sent, and uploaded files stay. It doesn't start or hand in the client's onboarding.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The client's onboarding, without passwords
 *       404:
 *         description: No such client, or one the caller can't see
 */
router.patch("/clients/:clientId", protect, authorize(...CAN_MANAGE), onboardingCommentsClientRule, answerRules, validate, updateClientOnboarding);

/**
 * @swagger
 * /onboarding/clients/{clientId}/custom-accounts:
 *   post:
 *     summary: Staff — add an account of the team's own to a client's onboarding form (Social media or Google step)
 *     description: "`name` is what the client sees (\"Discord\"). `section` is social (default) or google: the step it is asked on like the others — an invite to our access email, or its login. It is the item `<section>.<key>` for the team's ticks and comments. The client's form hears of it at once (onboarding:controls)."
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: The account's key and name
 *       409:
 *         description: There is one of that name already, or too many
 * /onboarding/clients/{clientId}/custom-accounts/{key}:
 *   delete:
 *     summary: Staff — take an account the team added off a client's onboarding form
 *     description: Its answers go with it, and it leaves the team's ticks and asks.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Taken off
 *       404:
 *         description: No such account on this client
 */
router.post("/clients/:clientId/custom-accounts", protect, authorize(...CAN_MANAGE), addCustomAccountRules, validate, addClientCustomAccount);
router.delete("/clients/:clientId/custom-accounts/:key", protect, authorize(...CAN_MANAGE), removeCustomAccountRules, validate, removeClientCustomAccount);

/**
 * @swagger
 * /onboarding/clients/{clientId}/password:
 *   get:
 *     summary: Staff (managers) — read one password a client shared on their onboarding form
 *     description: "`login` is where it is kept: domain, hosting, cms, or an account such as google.ads or social.instagram. Opened only on request; the client's record never carries it readable."
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The password
 *       404:
 *         description: No such client, or no password saved there
 *       423:
 *         description: The security code wasn't entered
 */
/**
 * @swagger
 * /onboarding/clients/{clientId}/media/{kind}:
 *   post:
 *     summary: Staff (managers) — upload files for a client's onboarding (logo, style references, photos, videos)
 *     description: The same as the client's own upload — a multipart form with the files under `files`, the same types, sizes and limits.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: The files now stored for that kind
 *   delete:
 *     summary: Staff (managers) — remove one of a client's uploaded files
 *     description: Send the file's `url` in the body.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The files left for that kind
 */
router.post(
  "/clients/:clientId/media/:kind",
  protect,
  authorize(...CAN_MANAGE),
  onboardingCommentsClientRule,
  onboardingMediaKindRule,
  validate,
  onboardingMediaUpload,
  uploadClientOnboardingMedia
);
router.delete(
  "/clients/:clientId/media/:kind",
  protect,
  authorize(...CAN_MANAGE),
  onboardingCommentsClientRule,
  onboardingMediaKindRule,
  removeOnboardingMediaRules,
  validate,
  removeClientOnboardingMedia
);

router.get("/clients/:clientId/password", protect, authorize(...CAN_MANAGE), onboardingCommentsClientRule, validate, revealClientOnboardingPassword);

router.get("/clients/:clientId/comments", protect, authorize(...STAFF_ROLES), onboardingCommentsClientRule, validate, listOnboardingComments);
router.post(
  "/clients/:clientId/comments",
  protect,
  authorize(...STAFF_ROLES),
  commentUpload,
  onboardingCommentsClientRule,
  addOnboardingCommentRules,
  validate,
  addOnboardingComment
);
router.post(
  "/clients/:clientId/comments/:commentId/replies",
  protect,
  authorize(...STAFF_ROLES),
  commentUpload,
  replyOnboardingCommentRules,
  validate,
  replyToOnboardingComment
);

router.get("/:id", onboardingIdRule, onboardingKeyRule, validate, getOnboarding);
router.patch("/:id", onboardingIdRule, onboardingKeyRule, updateOnboardingRules, validate, updateOnboarding);
router.delete("/:id", onboardingIdRule, onboardingKeyRule, validate, deleteOnboarding);

export default router;
