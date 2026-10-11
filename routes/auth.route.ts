import { Router } from "express";
import { signin, clientSignin, clientSignup, refreshAccessToken, signout } from "../controllers/auth.controller";
import { validate } from "../middleware/validate";
import { signinRules, clientSignupRules, refreshTokenRules } from "../validators/auth.validator";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Sign in, token refresh & sign out. Staff are created by an admin; a client can also make their own account (/auth/client/signup).
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     SigninInput:
 *       type: object
 *       required:
 *         - identifier
 *         - password
 *       properties:
 *         identifier:
 *           type: string
 *           description: Email address or phone number
 *           example: john@example.com
 *         password:
 *           type: string
 *           format: password
 *     AuthResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         data:
 *           type: object
 *           properties:
 *             user:
 *               $ref: '#/components/schemas/User'
 *             accessToken:
 *               type: string
 *             accessTokenExpiresAt:
 *               type: string
 *               format: date-time
 *             refreshToken:
 *               type: string
 *             refreshTokenExpiresAt:
 *               type: string
 *               format: date-time
 */

/**
 * @swagger
 * /auth/signin:
 *   post:
 *     summary: Sign in with any role
 *     description: For every role (employee, o_level, executive, hr, assistant_manager, manager, admin, superadmin, and client). Only accounts with status "active" can sign in.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SigninInput'
 *     responses:
 *       200:
 *         description: Signin successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Account is pending, inactive, or blocked
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
router.post("/signin", signinRules, validate, signin);

/**
 * @swagger
 * /auth/client/signin:
 *   post:
 *     summary: Sign in as a client
 *     description: Client accounts only. Credentials of any other role are rejected with 401, exactly like a wrong password.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SigninInput'
 *     responses:
 *       200:
 *         description: Client signin successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid credentials, or the account is not a client
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Account is pending, inactive, or blocked
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
router.post("/client/signin", signinRules, validate, clientSignin);

/**
 * @swagger
 * /auth/client/signup:
 *   post:
 *     summary: Create a client account
 *     description: Open to anyone. Creates an active client and its login (role "client") together. It does not sign them in — use /auth/client/signin afterwards.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, phone, password]
 *             properties:
 *               fullName:
 *                 type: string
 *                 example: David Carter
 *               email:
 *                 type: string
 *                 example: david@carterinjurylaw.com
 *               phone:
 *                 type: string
 *                 example: "+18135550142"
 *               password:
 *                 type: string
 *                 format: password
 *                 description: At least 8 characters, including a number
 *     responses:
 *       201:
 *         description: Account created
 *       409:
 *         description: The email or phone number already has an account
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
router.post("/client/signup", clientSignupRules, validate, clientSignup);

/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     summary: Exchange a refresh token for a new access token
 *     description: Rotates the refresh token — the presented one is invalidated and a new one is returned alongside the new access token. Reusing an already-rotated refresh token revokes every session for that user.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed
 *       401:
 *         description: Refresh token missing, invalid, expired, or already used
 */
router.post("/refresh-token", refreshTokenRules, validate, refreshAccessToken);

/**
 * @swagger
 * /auth/signout:
 *   post:
 *     summary: Revoke a refresh token
 *     description: Best-effort server-side revocation of the given refresh token. Always returns 200, even if the token was already invalid.
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Signed out
 */
router.post("/signout", signout);

export default router;
