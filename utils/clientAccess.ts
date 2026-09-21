import type { FilterQuery } from "mongoose";
import { Client, type IClient } from "../models/client.model";
import type { IUser } from "../models/user.model";

export const FULL_ACCESS_ROLES = ["admin", "superadmin"];

// Admins see every client; everyone else only sees the clients they own,
// are assigned to, or created. Used by clients and by everything hung off a client.
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
