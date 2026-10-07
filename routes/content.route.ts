import { Router } from "express";
import {
  createContent,
  createContentBatch,
  listContent,
  getContent,
  updateContent,
  changeContentStatus,
  deleteContent,
  addContentComment,
  listMyContent,
  getMyContent,
  updateMyContent,
  approveMyContent,
  addMyContentComment,
} from "../controllers/content.controller";
import { protect, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { commentUpload, contentBatchUpload, contentUpload } from "../middleware/upload";
import {
  contentIdRule,
  createContentRules,
  createContentBatchRules,
  updateContentRules,
  changeStatusRules,
  approveMyContentRules,
  commentRules,
  listContentRules,
  listMyContentRules,
  updateMyContentRules,
} from "../validators/content.validator";
import { CONTENT_READ_ROLES, CONTENT_WRITE_ROLES } from "../utils/contentAccess";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Content
 *   description: >
 *     Everything an account manager prepares for a client — image posts, carousels, stories,
 *     videos, blog articles, website copy, email newsletters, Google Business posts and ad
 *     creatives. Each piece belongs to a batch in a month: the regular monthly batch, one week of
 *     it, an event, or a one-off (individual) send. Files go to DigitalOcean Spaces (any number per
 *     piece). Staff save a piece as a draft or send it straight to the client (pending_approval);
 *     the client then approves it or requests a revision, which staff address and send back.
 *     Staff see the content of clients they own, are assigned to, or created (admins see all);
 *     clients only ever see their own, never a draft.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Content:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         client: { type: string }
 *         type: { type: string, enum: [image, carousel, story, video, blog, website, email, gmb, ad] }
 *         title: { type: string }
 *         group: { type: string, description: Shared by pieces saved together on the Add Content page; missing on a piece saved alone }
 *         pieces:
 *           type: array
 *           description: Every piece in this one's group, in the order added (this piece included). Sent with a single piece and with a grouped list.
 *           items:
 *             type: object
 *             properties:
 *               _id: { type: string }
 *               type: { type: string }
 *               title: { type: string }
 *               status: { type: string }
 *               thumbnail: { type: string, description: The piece's first image, when it has one }
 *         batchMonth: { type: string, example: September 2026 }
 *         batchType: { type: string, enum: [monthly, weekly, event, individual] }
 *         weekStart: { type: string, format: date, description: The Monday of the week (weekly) }
 *         eventName: { type: string, description: event }
 *         eventDate: { type: string, format: date, description: event }
 *         sentReason: { type: string, description: individual }
 *         isIndividual: { type: boolean, description: Same as batchType === individual (kept for older readers) }
 *         status: { type: string, enum: [draft, pending_approval, revision_requested, approved] }
 *         files: { type: array, items: { $ref: '#/components/schemas/ContentFile' } }
 *         link: { type: string, description: Pasted link, for video / blog / website / email }
 *         pageName: { type: string, description: website }
 *         pageUrl: { type: string, description: website }
 *         subject: { type: string, description: email }
 *         headline: { type: string, description: ad }
 *         cta: { type: string, enum: [Learn more, Call now, Book, Get offer, Sign up, Contact us], description: gmb / ad }
 *         caption: { type: string }
 *         tags: { type: array, items: { type: string } }
 *         imageUrl: { type: string, description: First image in files (kept for older readers) }
 *         videoUrl: { type: string, description: First video in files, or the link (kept for older readers) }
 *         docUrl: { type: string, description: First document in files, or the link (kept for older readers) }
 *         docName: { type: string }
 *         comments:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               author: { type: string, enum: [client, team] }
 *               user: { type: string }
 *               name: { type: string }
 *               text: { type: string }
 *               revision: { type: integer, description: "On a client's request for changes, the revision round it belongs to" }
 *               createdAt: { type: string, format: date-time }
 *         previousFiles:
 *           type: array
 *           description: Files replaced while answering a revision, newest first
 *           items:
 *             allOf:
 *               - $ref: '#/components/schemas/ContentFile'
 *               - type: object
 *                 properties:
 *                   replacedAt: { type: string, format: date-time }
 *                   revision: { type: integer }
 *         revisionCount: { type: integer, description: How many times the piece has been sent back for a revision }
 *         revisions:
 *           type: array
 *           description: Every revision the piece has been through, oldest first
 *           items:
 *             type: object
 *             properties:
 *               number: { type: integer }
 *               requests:
 *                 type: array
 *                 description: What the client asked for in this round
 *                 items:
 *                   type: object
 *                   properties:
 *                     text: { type: string }
 *                     attachments: { type: array, items: { $ref: '#/components/schemas/ContentFile' } }
 *                     name: { type: string }
 *                     createdAt: { type: string, format: date-time }
 *               responses:
 *                 type: array
 *                 description: The team's feedback on this round, with any files
 *                 items:
 *                   type: object
 *                   properties:
 *                     text: { type: string }
 *                     attachments: { type: array, items: { $ref: '#/components/schemas/ContentFile' } }
 *                     name: { type: string }
 *                     createdAt: { type: string, format: date-time }
 *               requestedAt: { type: string, format: date-time }
 *               requestedByName: { type: string }
 *               submittedAt: { type: string, format: date-time, description: When the team sent the revised piece back }
 *               submittedByName: { type: string }
 *               note: { type: string, description: The team's note with the revised piece }
 *         createdBy: { type: string }
 *         submittedAt: { type: string, format: date-time }
 *         approvedBy: { type: string }
 *         approvedAt: { type: string, format: date-time }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     ContentBatchFields:
 *       type: object
 *       required: [client, batchMonth]
 *       properties:
 *         client: { type: string, description: Client id }
 *         batchMonth: { type: string, example: September 2026 }
 *         batchType: { type: string, enum: [monthly, weekly, event, individual], default: monthly }
 *         weekStart: { type: string, format: date, description: Required when batchType is weekly }
 *         eventName: { type: string, description: Required when batchType is event }
 *         eventDate: { type: string, format: date, description: Required when batchType is event }
 *         sentReason: { type: string, description: Required when batchType is individual }
 *         status: { type: string, enum: [draft, pending_approval], default: draft, description: Save as a draft or send straight to the client }
 */

/**
 * @swagger
 * /content:
 *   post:
 *     summary: Create one content piece
 *     description: >
 *       Roles: employee, executive, assistant_manager, manager, admin, superadmin — for clients
 *       they can see. Send multipart/form-data with up to 40 `files` parts (images, videos or
 *       documents, as the type allows), and/or a pasted `link` for video / blog / website /
 *       email. Each type has its own rules — a carousel needs at least 2 images; website needs
 *       `pageName`, email needs `subject`, an ad needs `headline`. Set `status` to
 *       `pending_approval` to send it to the client straight away.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ContentBatchFields'
 *               - type: object
 *                 required: [type, title]
 *                 properties:
 *                   type: { type: string, enum: [image, carousel, story, video, blog, website, email, gmb, ad] }
 *                   title: { type: string }
 *                   files: { type: array, items: { type: string, format: binary }, maxItems: 10 }
 *                   link: { type: string }
 *                   caption: { type: string }
 *                   pageName: { type: string }
 *                   pageUrl: { type: string }
 *                   subject: { type: string }
 *                   headline: { type: string }
 *                   cta: { type: string }
 *                   tags: { type: string, description: JSON array or comma-separated }
 *     responses:
 *       201:
 *         description: Content saved as a draft, or sent for approval
 *       404:
 *         description: Client not found, or not one of your clients
 *       422:
 *         description: Validation failed — `errors` lists what's missing, or which file doesn't fit the type
 *   get:
 *     summary: List content
 *     description: Newest first, with counts per status across everything you can see.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: client, schema: { type: string } }
 *       - { in: query, name: type, schema: { type: string, enum: [image, carousel, story, video, blog, website, email, gmb, ad] } }
 *       - { in: query, name: status, schema: { type: string, enum: [draft, pending_approval, revision_requested, approved] } }
 *       - { in: query, name: batchMonth, schema: { type: string } }
 *       - { in: query, name: batchType, schema: { type: string, enum: [monthly, weekly, event, individual] } }
 *       - { in: query, name: individual, schema: { type: boolean } }
 *       - { in: query, name: q, schema: { type: string }, description: Search the title }
 *       - { in: query, name: grouped, schema: { type: boolean }, description: One item per group of pieces saved together — the group's first piece, with `pieces` listing all of them. A group shows if any of its pieces matches the filters. }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Content fetched successfully
 */
router.post(
  "/",
  protect,
  authorize(...CONTENT_WRITE_ROLES),
  contentUpload,
  createContentRules,
  validate,
  createContent
);
router.get("/", protect, authorize(...CONTENT_READ_ROLES), listContentRules, validate, listContent);

/**
 * @swagger
 * /content/batch:
 *   post:
 *     summary: Create several content pieces at once
 *     description: >
 *       What the Add Content page sends. The batch fields (client, month, batch type, status)
 *       apply to every piece. `pieces` is a JSON array (up to 10) of each piece's own fields —
 *       type, title, caption, link, pageName, pageUrl, subject, headline, cta. Each piece's files
 *       go in multipart parts named `files[0]`, `files[1]`, … matching its position in `pieces`
 *       (40 files at most in one request). Nothing is saved unless every piece is complete.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ContentBatchFields'
 *               - type: object
 *                 required: [pieces]
 *                 properties:
 *                   pieces:
 *                     type: string
 *                     description: JSON array of pieces
 *                     example: '[{"type":"image","title":"Know Your Rights"},{"type":"video","title":"First 24 Hours","link":"https://youtu.be/…"}]'
 *                   "files[0]": { type: array, items: { type: string, format: binary } }
 *                   "files[1]": { type: array, items: { type: string, format: binary } }
 *     responses:
 *       201:
 *         description: Pieces saved as drafts, or sent for approval — `data.items` holds them
 *       404:
 *         description: Client not found, or not one of your clients
 *       422:
 *         description: Some pieces are incomplete — `errors` says which ("Piece 2 — …")
 */
router.post(
  "/batch",
  protect,
  authorize(...CONTENT_WRITE_ROLES),
  contentBatchUpload,
  createContentBatchRules,
  validate,
  createContentBatch
);

/**
 * @swagger
 * /content/me:
 *   get:
 *     summary: The signed-in client's own content
 *     description: For the client portal. Only their own company's content, and never a draft.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: batchMonth, schema: { type: string } }
 *       - { in: query, name: batchType, schema: { type: string, enum: [monthly, weekly, event, individual] } }
 *       - { in: query, name: individual, schema: { type: boolean } }
 *       - { in: query, name: grouped, schema: { type: boolean }, description: One item per group of pieces sent together (see GET /content) }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Content fetched successfully
 *       403:
 *         description: Not a client account
 */
router.get("/me", protect, authorize("client"), listMyContentRules, validate, listMyContent);

/**
 * @swagger
 * /content/me/{id}:
 *   get:
 *     summary: One of the signed-in client's own content items
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Content fetched successfully
 *       404:
 *         description: Not found, still a draft, or not yours
 */
router.get("/me/:id", protect, authorize("client"), contentIdRule, validate, getMyContent);

/**
 * @swagger
 * /content/me/{id}:
 *   patch:
 *     summary: Edit the caption and tags of one of the signed-in client's own content items
 *     description: >
 *       Only the caption and tags, and only while the item is waiting for approval or in revision.
 *       The status doesn't change; a note is added to the item's comments so the team sees the edit.
 *     tags: [Content]
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
 *             properties:
 *               caption: { type: string, maxLength: 2000 }
 *               tags: { type: array, maxItems: 20, items: { type: string, maxLength: 50 } }
 *     responses:
 *       200:
 *         description: Content updated
 *       400:
 *         description: Not yet sent for approval, or already approved
 *       404:
 *         description: Not found, or not yours
 *       422:
 *         description: Validation failed
 */
router.patch("/me/:id", protect, authorize("client"), contentIdRule, updateMyContentRules, validate, updateMyContent);

/**
 * @swagger
 * /content/me/{id}/approve:
 *   patch:
 *     summary: Approve one of the signed-in client's own content items
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               comment: { type: string, maxLength: 1000, description: An optional note left with the approval; added to the comments }
 *     responses:
 *       200:
 *         description: Content approved
 *       400:
 *         description: Not yet sent for approval, or already approved
 *       404:
 *         description: Not found, or not yours
 */
router.patch("/me/:id/approve", protect, authorize("client"), contentIdRule, approveMyContentRules, validate, approveMyContent);

/**
 * @swagger
 * /content/me/{id}/comments:
 *   post:
 *     summary: Comment on one of the signed-in client's own content items
 *     description: With kind set to revision, adds the comment and moves the item to revision_requested, starting a new revision round unless one is under way; this also reopens an approved item. With kind set to message it only adds the comment. With no kind it asks for changes on an item that is waiting or in revision, and only adds the comment on an approved one.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       description: Text, up to 5 attached files (images, videos, documents), or both.
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               text: { type: string, maxLength: 1000 }
 *               kind: { type: string, enum: [message, revision] }
 *               files: { type: array, maxItems: 5, items: { type: string, format: binary } }
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string, maxLength: 1000 }
 *               kind: { type: string, enum: [message, revision] }
 *     responses:
 *       200:
 *         description: Comment added
 *       400:
 *         description: Not yet sent for approval
 *       404:
 *         description: Not found, or not yours
 */
router.post("/me/:id/comments", protect, authorize("client"), commentUpload, contentIdRule, commentRules, validate, addMyContentComment);

/**
 * @swagger
 * /content/{id}:
 *   get:
 *     summary: Get one content item
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Content fetched successfully
 *       404:
 *         description: Not found, or belongs to a client you can't see
 *   patch:
 *     summary: Edit a content piece, add files, or remove files
 *     description: >
 *       Send only what changes. Same multipart/form-data or JSON body shape as create, minus
 *       `client` and `type` (fixed at creation). New `files` are added to the piece (40 at most
 *       in one request — send `extend: true` with a further request to add more to the same upload); `removeFiles` (a JSON array or comma-separated list of file URLs) drops existing
 *       ones, which are then deleted from DigitalOcean Spaces. Once the client has sent the piece
 *       back for a revision, files are versions instead — new `files` go first and replace what the
 *       piece had, except the URLs listed in `keepFiles`, and whatever is replaced or dropped is kept
 *       in `previousFiles` rather than deleted. An approved piece can only be edited by a manager.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Content updated successfully
 *       403:
 *         description: Already approved and you are not a manager
 *       404:
 *         description: Content not found
 *       422:
 *         description: Validation failed, or the file doesn't match the declared type
 *   delete:
 *     summary: Delete a content item
 *     description: Superadmin only, in any status. Also deletes its files from DigitalOcean Spaces.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Content deleted successfully
 *       403:
 *         description: Only a superadmin can delete content
 *       404:
 *         description: Content not found
 */
router.get("/:id", protect, authorize(...CONTENT_READ_ROLES), contentIdRule, validate, getContent);
router.patch(
  "/:id",
  protect,
  authorize(...CONTENT_WRITE_ROLES),
  contentUpload,
  contentIdRule,
  updateContentRules,
  validate,
  updateContent
);
router.delete("/:id", protect, authorize("superadmin"), contentIdRule, validate, deleteContent);

/**
 * @swagger
 * /content/{id}/status:
 *   patch:
 *     summary: Move a content item's status
 *     description: >
 *       Writers can send a draft (or a revised item) for approval. Managers, admins and
 *       superadmins can also approve or request a revision on the client's behalf, or send
 *       an already-sent item back to draft.
 *     tags: [Content]
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
 *               status: { type: string, enum: [draft, pending_approval, revision_requested, approved] }
 *               note: { type: string, maxLength: 1000, description: What changed, for the client. Kept with the revision when a revised item is sent back for approval }
 *     responses:
 *       200:
 *         description: Content status changed
 *       400:
 *         description: Already in that status
 *       403:
 *         description: Your role cannot make this move
 *       404:
 *         description: Content not found
 */
router.patch(
  "/:id/status",
  protect,
  authorize(...CONTENT_WRITE_ROLES),
  contentIdRule,
  changeStatusRules,
  validate,
  changeContentStatus
);

/**
 * @swagger
 * /content/{id}/comments:
 *   post:
 *     summary: Reply on a content item's comment thread
 *     description: A team reply. On its own it doesn't change the status. With kind set to revision while the item is in revision, it is kept as the team's feedback on that revision; adding resubmit also sends the revised item back for approval.
 *     tags: [Content]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       description: Text, up to 5 attached files (images, videos, documents), or both.
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               text: { type: string, maxLength: 1000 }
 *               kind: { type: string, enum: [revision], description: Keep it as feedback on the revision under way }
 *               resubmit: { type: boolean, description: With kind revision, also send the revised item back for approval }
 *               files: { type: array, maxItems: 5, items: { type: string, format: binary } }
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string, maxLength: 1000 }
 *               kind: { type: string, enum: [revision] }
 *               resubmit: { type: boolean }
 *     responses:
 *       200:
 *         description: Comment added
 *       404:
 *         description: Content not found
 */
router.post(
  "/:id/comments",
  protect,
  authorize(...CONTENT_WRITE_ROLES),
  commentUpload,
  contentIdRule,
  commentRules,
  validate,
  addContentComment
);

export default router;
