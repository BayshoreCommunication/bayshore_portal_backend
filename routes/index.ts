import { Router } from "express";
import authRoutes from "./auth.route";
import userRoutes from "./user.route";
import clientRoutes from "./client.route";
import reportRoutes from "./report.route";
import contentRoutes from "./content.route";
import leadRoutes from "./lead.route";
import projectRoutes from "./project.route";
import serviceRoutes from "./service.route";
import paymentRoutes from "./payment.route";
import auditLogRoutes from "./auditLog.route";
import notificationRoutes from "./notification.route";
import messageRoutes from "./message.route";
import onboardingRoutes from "./onboarding.route";

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
router.use("/content", contentRoutes);
router.use("/leads", leadRoutes);
router.use("/projects", projectRoutes);
router.use("/services", serviceRoutes);
router.use("/payments", paymentRoutes);
router.use("/audit-logs", auditLogRoutes);
router.use("/notifications", notificationRoutes);
router.use("/messages", messageRoutes);
// Open routes (no sign-in): the onboarding form, kept to its own answers by a key.
router.use("/onboarding", onboardingRoutes);

export default router;
