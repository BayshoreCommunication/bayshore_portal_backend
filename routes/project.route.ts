import { Router } from "express";
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  listMyProjects,
  getMyProject,
  createMyProject,
  updateMyProject,
  deleteMyProject,
} from "../controllers/project.controller";
import { protect, authorize } from "../middleware/auth";
import { projectUpload } from "../middleware/upload";
import { validate } from "../middleware/validate";
import {
  projectIdRule,
  createProjectRules,
  updateProjectRules,
  createMyProjectRules,
  updateMyProjectRules,
  listProjectsRules,
  listMyProjectsRules,
} from "../validators/project.validator";
import { PROJECT_READ_ROLES, PROJECT_WRITE_ROLES, PROJECT_DELETE_ROLES } from "../utils/projectAccess";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Projects
 *   description: >
 *     Larger pieces of work for a client. Either side can open one: the client from their portal
 *     (the /projects/me routes) or staff on the client's behalf. Staff see the projects of clients
 *     they own, are assigned to, or created (admins see all), and move each one through
 *     new → in_progress → completed. Clients see the status but can't change it.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ProjectInput:
 *       type: object
 *       description: >
 *         Sent as multipart/form-data so files can ride along. When editing, send only what changes.
 *       properties:
 *         name: { type: string, maxLength: 120 }
 *         description: { type: string, maxLength: 2000 }
 *         targetDate: { type: string, format: date, description: Send it empty to clear it }
 *         priority: { type: string, enum: [low, normal, high] }
 *         files:
 *           type: array
 *           description: Up to 10 per project and 25MB each. Images or PDF or Word or Excel or PowerPoint or text or ZIP or MP4/MOV/WEBM video.
 *           items: { type: string, format: binary }
 *         removeFiles:
 *           type: array
 *           description: Editing only. URLs of the project's files to drop.
 *           items: { type: string }
 *     ProjectList:
 *       type: object
 *       properties:
 *         success: { type: boolean }
 *         message: { type: string }
 *         data:
 *           type: object
 *           properties:
 *             projects:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Project'
 *             summary:
 *               type: object
 *               description: Projects per status for the client filter only. The other filters don't change it.
 *               properties:
 *                 total: { type: integer }
 *                 new: { type: integer }
 *                 in_progress: { type: integer }
 *                 completed: { type: integer }
 *             pagination:
 *               type: object
 *               properties:
 *                 page: { type: integer }
 *                 limit: { type: integer }
 *                 total: { type: integer }
 *                 totalPages: { type: integer }
 */

/**
 * @swagger
 * /projects:
 *   post:
 *     summary: Open a project for a client
 *     description: >
 *       Roles: employee, executive, assistant_manager, manager, admin, superadmin — for clients they can see.
 *       Starts as "new" unless a status is given.
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ProjectInput'
 *               - type: object
 *                 required: [client, name]
 *                 properties:
 *                   client: { type: string, description: Client id }
 *                   status: { type: string, enum: [new, in_progress, completed] }
 *     responses:
 *       201:
 *         description: Project created successfully
 *       404:
 *         description: Client not found, or not one of your clients
 *       422:
 *         description: Validation failed, or a file is too large or of an unsupported type
 *   get:
 *     summary: List projects
 *     description: Newest first, with counts per status for the tiles.
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: client, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [new, in_progress, completed] } }
 *       - { in: query, name: priority, schema: { type: string, enum: [low, normal, high] } }
 *       - { in: query, name: q, schema: { type: string }, description: Search the name or description or the client's company name }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Projects fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProjectList'
 */
router.post("/", protect, authorize(...PROJECT_WRITE_ROLES), projectUpload, createProjectRules, validate, createProject);
router.get("/", protect, authorize(...PROJECT_READ_ROLES), listProjectsRules, validate, listProjects);

/**
 * @swagger
 * /projects/me:
 *   get:
 *     summary: The signed-in client's projects
 *     description: For the client portal. The caller's own company only, without staff-only details.
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [new, in_progress, completed] } }
 *       - { in: query, name: priority, schema: { type: string, enum: [low, normal, high] } }
 *       - { in: query, name: q, schema: { type: string }, description: Search the name or description }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Projects fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProjectList'
 *       403:
 *         description: Not a client account
 *   post:
 *     summary: Open a project from the client portal
 *     description: Always starts as "new". The status can't be sent.
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ProjectInput'
 *               - type: object
 *                 required: [name]
 *     responses:
 *       201:
 *         description: Project created successfully
 *       422:
 *         description: Validation failed, or a file is too large or of an unsupported type
 */
router.get("/me", protect, authorize("client"), listMyProjectsRules, validate, listMyProjects);
router.post("/me", protect, authorize("client"), projectUpload, createMyProjectRules, validate, createMyProject);

/**
 * @swagger
 * /projects/me/{id}:
 *   get:
 *     summary: One of the signed-in client's projects
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Project fetched successfully
 *       404:
 *         description: Not found, or not yours
 *   patch:
 *     summary: Edit one of the signed-in client's projects
 *     description: Allowed until the project is completed. The status can't be sent.
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/ProjectInput'
 *     responses:
 *       200:
 *         description: Project updated successfully
 *       404:
 *         description: Not found, or not yours
 *       409:
 *         description: The project is completed
 *       422:
 *         description: Validation failed
 *   delete:
 *     summary: Delete one of the signed-in client's projects
 *     description: Allowed only while the project is still "new". Its files are removed from storage.
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Project deleted successfully
 *       404:
 *         description: Not found, or not yours
 *       409:
 *         description: Work has already started
 */
router.get("/me/:id", protect, authorize("client"), projectIdRule, validate, getMyProject);
router.patch("/me/:id", protect, authorize("client"), projectUpload, projectIdRule, updateMyProjectRules, validate, updateMyProject);
router.delete("/me/:id", protect, authorize("client"), projectIdRule, validate, deleteMyProject);

/**
 * @swagger
 * /projects/{id}:
 *   get:
 *     summary: Get one project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Project fetched successfully
 *       404:
 *         description: Not found, or belongs to a client you can't see
 *   patch:
 *     summary: Edit a project or move it along
 *     description: >
 *       Send only what changes. Changing the status stamps startedAt / completedAt. The client can't be changed.
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ProjectInput'
 *               - type: object
 *                 properties:
 *                   status: { type: string, enum: [new, in_progress, completed] }
 *     responses:
 *       200:
 *         description: Project updated successfully
 *       404:
 *         description: Project not found
 *       422:
 *         description: Validation failed
 *   delete:
 *     summary: Delete a project
 *     description: Roles manager, admin, superadmin. Its files are removed from storage. Recorded in the audit log.
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Project deleted successfully
 *       404:
 *         description: Project not found
 */
router.get("/:id", protect, authorize(...PROJECT_READ_ROLES), projectIdRule, validate, getProject);
router.patch("/:id", protect, authorize(...PROJECT_WRITE_ROLES), projectUpload, projectIdRule, updateProjectRules, validate, updateProject);
router.delete("/:id", protect, authorize(...PROJECT_DELETE_ROLES), projectIdRule, validate, deleteProject);

export default router;
