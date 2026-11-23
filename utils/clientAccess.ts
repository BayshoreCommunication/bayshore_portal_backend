import type { FilterQuery } from "mongoose";
import { Client, type IClient } from "../models/client.model";
import { USER_ROLES, type IUser, type UserRole } from "../models/user.model";

// Every staff member may now READ every client (and all that hangs off a client). What each may
// CHANGE is still decided by role, on the write routes (authorize(...) in the route files). Only
// a "client" account is kept out — clients never reach here; they use the /me routes, limited to
// their own company.
export const FULL_ACCESS_ROLES: UserRole[] = USER_ROLES.filter((role) => role !== "client");

// Staff see every client; everyone else (there is no one else here — clients use /me) would only
// see the clients they own, are assigned to, or created. Used by clients and by everything hung
// off a client.
export const clientScopeFor = (requester: IUser): FilterQuery<IClient> =>
  FULL_ACCESS_ROLES.includes(requester.role)
    ? {}
    : {
        $or: [
          { accountManager: requester._id },
          { team: requester._id },
          { createdBy: requester._id },
        ],
      };

// The clients this staff member may work on, as a filter for a `client` field on
// another collection. Admins get no filter at all (they can see everything).
export const visibleClientFilter = async (requester: IUser) => {
  if (FULL_ACCESS_ROLES.includes(requester.role)) return {};
  const ids = await Client.find(clientScopeFor(requester)).distinct("_id");
  return { client: { $in: ids } };
};

export const canAccessClient = async (requester: IUser, clientId: unknown) =>
  Boolean(await Client.exists({ $and: [{ _id: clientId }, clientScopeFor(requester)] }));
