import { Router } from "express";
import authRoutes from "./auth.route";
import userRoutes from "./user.route";
import clientRoutes from "./client.route";
import reportRoutes from "./report.route";
import auditLogRoutes from "./auditLog.route";

const router = Router();

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Check API health
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 */
router.get("/health", (req, res) => {
  res.status(200).json({ success: true, message: "API is healthy" });
});

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/clients", clientRoutes);
router.use("/reports", reportRoutes);
router.use("/audit-logs", auditLogRoutes);

export default router;
