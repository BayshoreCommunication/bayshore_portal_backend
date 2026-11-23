import { Router } from "express";
import {
  listMeetings,
  getMeeting,
  cancelMeeting,
  listSlots,
  listSelectableStaff,
  listMyMeetings,
  createMyMeeting,
  cancelMyMeeting,
} from "../controllers/meeting.controller";
import { protect, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { meetingIdRule, createMyMeetingRules } from "../validators/meeting.validator";

const router = Router();

// Staff roles — anyone on the team may reach the staff routes; what they see is then narrowed to
// the meetings they're on (a super user sees all) inside the controller.
const STAFF = ["employee", "o_level", "executive", "hr", "assistant_manager", "manager", "admin", "superadmin"] as const;

// ── Client portal (the signed-in client's own meetings) ──────────────────────
router.get("/me/slots", protect, authorize("client"), listSlots);
router.get("/me/staff", protect, authorize("client"), listSelectableStaff);
router.get("/me", protect, authorize("client"), listMyMeetings);
router.post("/me", protect, authorize("client"), createMyMeetingRules, validate, createMyMeeting);
router.delete("/me/:id", protect, authorize("client"), meetingIdRule, validate, cancelMyMeeting);

// ── Company portal (staff) ───────────────────────────────────────────────────
router.get("/", protect, authorize(...STAFF), listMeetings);
router.get("/:id", protect, authorize(...STAFF), meetingIdRule, validate, getMeeting);
router.patch("/:id/cancel", protect, authorize(...STAFF), meetingIdRule, validate, cancelMeeting);

export default router;
