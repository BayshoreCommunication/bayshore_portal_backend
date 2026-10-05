import { USER_ROLES, type UserRole } from "../models/user.model";

// Who may do what with leads. Everything is also limited to the clients the
// person can see (see utils/clientAccess.ts) — these lists are only the role part.
// Clients only ever read their own leads, through the /leads/me routes.

// Anyone on staff can read the leads of clients they can see.
export const LEAD_READ_ROLES = USER_ROLES.filter((role) => role !== "client") as UserRole[];

// Add leads, edit them and move them through the pipeline.
export const LEAD_WRITE_ROLES: UserRole[] = [
  "employee",
  "executive",
  "assistant_manager",
  "manager",
  "admin",
  "superadmin",
];

export const LEAD_DELETE_ROLES: UserRole[] = ["manager", "admin", "superadmin"];
