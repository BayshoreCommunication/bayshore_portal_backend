import { USER_ROLES, type UserRole } from "../models/user.model";

// Who may do what with reports. Everything is also limited to the clients the
// person can see (see utils/clientAccess.ts) — these lists are only the role part.

// Anyone on staff can read the reports of clients they can see.
export const REPORT_READ_ROLES = USER_ROLES.filter((role) => role !== "client") as UserRole[];

// Write reports and hand them in for review.
export const REPORT_WRITE_ROLES: UserRole[] = [
  "employee",
  "executive",
  "assistant_manager",
  "manager",
  "admin",
  "superadmin",
];

// Review: approve, publish, send back, and edit a report after it has been handed in.
export const REPORT_REVIEW_ROLES: UserRole[] = ["manager", "admin", "superadmin"];

export const REPORT_DELETE_ROLES: UserRole[] = ["admin", "superadmin"];
