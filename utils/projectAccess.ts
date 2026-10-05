import { USER_ROLES, type UserRole } from "../models/user.model";

// Who on staff may do what with projects. Everything is also limited to the
// clients the person can see (see utils/clientAccess.ts) — these lists are only
// the role part. Clients work on their own projects through the /projects/me routes.

// Anyone on staff can read the projects of clients they can see.
export const PROJECT_READ_ROLES = USER_ROLES.filter((role) => role !== "client") as UserRole[];

// Open a project for a client, edit it and move it along.
export const PROJECT_WRITE_ROLES: UserRole[] = [
  "employee",
  "executive",
  "assistant_manager",
  "manager",
  "admin",
  "superadmin",
];

export const PROJECT_DELETE_ROLES: UserRole[] = ["manager", "admin", "superadmin"];
