import { Client, type ClientStatus } from "../models/client.model";
import type { IUser } from "../models/user.model";

// A client's logins work only while the client is being onboarded or is active. Pending, on
// hold and closed clients can't sign in, keep a session, or use the API — whatever their
// login's own status says. (Staff accounts aren't affected.)
export const CLIENT_SIGN_IN_STATUSES: ClientStatus[] = ["onboarding", "active"];

export const CLIENT_NOT_ALLOWED_MESSAGE = "Your account isn't active right now. Please contact your account manager.";

// Whether this account may be signed in: always for staff; for a client login, only while its
// client's status allows it.
export const clientMaySignIn = async (user: Pick<IUser, "role" | "client">): Promise<boolean> => {
  if (user.role !== "client") return true;
  if (!user.client) return false;
  const client = await Client.findById(user.client).select("status").lean();
  return Boolean(client && CLIENT_SIGN_IN_STATUSES.includes(client.status));
};
