import { USER_ROLES, type UserRole } from "../models/user.model";

// Who may do what with content. Everything is also limited to the clients the
// person can see (see utils/clientAccess.ts) — these lists are only the role part.

// Anyone on staff can read the content of clients they can see.
export const CONTENT_READ_ROLES = USER_ROLES.filter((role) => role !== "client") as UserRole[];

// Prepare content, edit it, send it for approval, and reply to a client's comment.
export const CONTENT_WRITE_ROLES: UserRole[] = [
  "employee",
  "executive",
  "assistant_manager",
  "manager",
  "admin",
  "superadmin",
];

// Can force a status the normal draft → pending_approval → approved flow
// wouldn't otherwise allow — approve or request revision on the client's
// behalf, or send an item that's already out for review back to draft.
export const CONTENT_REVIEW_ROLES: UserRole[] = ["manager", "admin", "superadmin"];
