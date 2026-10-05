import { USER_ROLES, type UserRole } from "../models/user.model";

// Who on staff may do what with services.

// Anyone on staff can read the catalog and the services of clients they can see.
export const SERVICE_READ_ROLES = USER_ROLES.filter((role) => role !== "client") as UserRole[];

// The catalog itself — adding, editing and deleting services — is the superadmin's.
export const SERVICE_MANAGE_ROLES: UserRole[] = ["superadmin"];

// Choosing which catalog services a client takes, for the clients a person can see
// (see utils/clientAccess.ts).
export const SERVICE_ASSIGN_ROLES: UserRole[] = [
  "employee",
  "executive",
  "assistant_manager",
  "manager",
  "admin",
  "superadmin",
];
