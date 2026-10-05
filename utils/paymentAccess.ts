import { USER_ROLES, type UserRole } from "../models/user.model";

// Anyone on staff can see the payments of clients they can see (utils/clientAccess.ts).
// Payments are made by clients through Stripe; nobody edits them here.
export const PAYMENT_READ_ROLES = USER_ROLES.filter((role) => role !== "client") as UserRole[];
