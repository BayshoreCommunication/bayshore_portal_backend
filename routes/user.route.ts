import { Router } from "express";
import {
  createStaff,
  getMe,
  updateAvatar,
  listStaff,
  updateStaff,
  deleteStaff,
  updateMe,
  changePassword,
} from "../controllers/user.controller";
import { protect, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { upload } from "../middleware/upload";
import {
  createStaffRules,
  updateStaffRules,
  updateMeRules,
  changePasswordRules,
} from "../validators/user.validator";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Staff user management (admin/superadmin only)
 */

/**
 * @swagger
 * /users/staff:
 *   post:
 *     summary: Create a manager, admin, or superadmin account
 *     description: >
 *       Requires a Bearer token from /auth/signin. A superadmin can create
 *       manager, admin, or superadmin accounts. An admin can only create manager
 *       accounts. Managers cannot access this endpoint at all.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *               - password
 *               - role
 *             properties:
 *               fullName:
 *                 type: string
 *               companyName:
 *                 type: string
 *               designation:
 *                 type: string
 *               department:
 *                 type: string
 *               responsibilities:
 *                 type: string
 *               address:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               avatar:
 *                 type: string
 *               password:
 *                 type: string
 *                 format: password
 *               role:
 *                 type: string
 *                 enum: [employee, client, o_level, executive, hr, assistant_manager, manager, admin, superadmin]
 *               status:
 *                 type: string
 *                 enum: [pending, active, inactive, blocked]
 *               muted:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Staff user created successfully
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
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Not permitted to create a user with the given role
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Email or phone already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       422:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.post(
  "/staff",
  protect,
  authorize("admin", "superadmin"),
  createStaffRules,
  validate,
  createStaff
);

/**
 * @swagger
 * /users/staff:
 *   get:
 *     summary: List manageable staff accounts (admin/superadmin only)
 *     description: >
 *       A superadmin sees manager, admin, and superadmin accounts. An admin
 *       sees manager accounts only.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Staff fetched successfully
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Not permitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.get("/staff", protect, authorize("admin", "superadmin"), listStaff);

/**
 * @swagger
 * /users/staff/{id}:
 *   patch:
 *     summary: Update a staff member's role or details (admin/superadmin only)
 *     description: >
 *       An admin can only manage manager accounts. A superadmin can manage
 *       manager, admin, and superadmin accounts. Neither can target their own
 *       account here — use /users/me for that.
 *     tags: [Users]
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
 *               fullName:
 *                 type: string
 *               companyName:
 *                 type: string
 *               designation:
 *                 type: string
 *               department:
 *                 type: string
 *               responsibilities:
 *                 type: string
 *               address:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [employee, client, o_level, executive, hr, assistant_manager, manager, admin, superadmin]
 *               status:
 *                 type: string
 *                 enum: [pending, active, inactive, blocked]
 *               muted:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Staff member updated successfully
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
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Cannot target your own account through this endpoint
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Not permitted to manage this account or assign this role
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Staff member not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Email or phone already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *   delete:
 *     summary: Remove a staff member (admin/superadmin only)
 *     description: >
 *       An admin can only remove manager accounts. A superadmin can remove
 *       manager, admin, and superadmin accounts. Neither can delete their own
 *       account here.
 *     tags: [Users]
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
 *         description: Staff member deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Cannot delete your own account through this endpoint
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Not permitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Staff member not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router
  .route("/staff/:id")
  .patch(
    protect,
    authorize("admin", "superadmin"),
    updateStaffRules,
    validate,
    updateStaff
  )
  .delete(protect, authorize("admin", "superadmin"), deleteStaff);

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Get the authenticated user's own profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile fetched successfully
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
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.get("/me", protect, getMe);

/**
 * @swagger
 * /users/me:
 *   patch:
 *     summary: Update the authenticated user's own profile (General settings)
 *     description: Does not change role or password — see /users/me/password for that.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName:
 *                 type: string
 *               companyName:
 *                 type: string
 *               designation:
 *                 type: string
 *               department:
 *                 type: string
 *               responsibilities:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               theme:
 *                 type: string
 *                 enum: [dark, light]
 *     responses:
 *       200:
 *         description: Profile updated successfully
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
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: Email or phone already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       422:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.patch("/me", protect, updateMeRules, validate, updateMe);

/**
 * @swagger
 * /users/me/password:
 *   patch:
 *     summary: Change the authenticated user's own password
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *               newPassword:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Password updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Not authenticated, or current password is incorrect
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       422:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.patch(
  "/me/password",
  protect,
  changePasswordRules,
  validate,
  changePassword
);

/**
 * @swagger
 * /users/me/avatar:
 *   patch:
 *     summary: Upload/update the authenticated user's avatar
 *     description: Available to any authenticated user (any role). Replaces and deletes the previous avatar from storage, if one existed.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - avatar
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar updated successfully
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
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       422:
 *         description: Missing file or invalid image type
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.patch("/me/avatar", protect, upload.single("avatar"), updateAvatar);

export default router;
