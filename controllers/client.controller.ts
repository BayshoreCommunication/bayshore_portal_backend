import mongoose, { type FilterQuery } from "mongoose";
import type { Request, Response } from "express";
import { Client, CLIENT_STATUSES, type IClient, type ClientStatus } from "../models/client.model";
import { User, type IUser, type UserStatus } from "../models/user.model";
import { RefreshToken } from "../models/refreshToken.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { deleteFromSpaces } from "../utils/uploadToSpaces";
import { clientScopeFor as scopeFor } from "../utils/clientAccess";

// A client's business status decides whether its logins may sign in.
const USER_STATUS_FOR: Record<ClientStatus, UserStatus> = {
  pending: "pending",
  active: "active",
  on_hold: "inactive",
  closed: "inactive",
};

// Trimmed, blanks dropped, duplicates removed (order kept).
const cleanServiceTypes = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const assertEmailAvailable = async (
  email: string,
  except: { clientId?: unknown; userId?: unknown } = {}
) => {
  const [client, user] = await Promise.all([
    Client.findOne({ email, ...(except.clientId ? { _id: { $ne: except.clientId } } : {}) }),
    User.findOne({ email, ...(except.userId ? { _id: { $ne: except.userId } } : {}) }),
  ]);
  if (client || user) throw new ApiError(409, "Email is already registered");
};

const assertPhoneAvailable = async (phone: string | undefined, exceptUserId?: unknown) => {
  if (!phone) return;
  const existing = await User.findOne({
    phone,
    ...(exceptUserId ? { _id: { $ne: exceptUserId } } : {}),
  });
  if (existing) throw new ApiError(409, "Phone number is already registered");
};

// accountManager / team must be real staff accounts, not clients or missing users.
const assertStaff = async (ids: unknown[]) => {
  const unique = Array.from(new Set(ids.filter(Boolean).map(String)));
  if (unique.length === 0) return;
  const found = await User.countDocuments({ _id: { $in: unique }, role: { $ne: "client" } });
  if (found !== unique.length) {
    throw new ApiError(422, "accountManager and team must be existing staff users");
  }
};

const findVisibleClient = async (requester: IUser, id: string) => {
  const client = await Client.findOne({ $and: [{ _id: id }, scopeFor(requester)] });
  if (!client) throw new ApiError(404, "Client not found");
  return client;
};

/**
 * Creates the client and, in the same call, its login account (role "client"),
 * filled in from the client's details and using the password that was sent.
 */
export const createClient = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const {
    contactName,
    companyName,
    phone,
    address,
    serviceTypes,
    startDate,
    status,
    notes,
    accountManager,
    team,
    password,
  } = req.body;
  const email = String(req.body.email).toLowerCase();

  await assertEmailAvailable(email);
  await assertPhoneAvailable(phone || undefined);
  await assertStaff([accountManager, ...(team ?? [])]);

  const clientId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const clientStatus: ClientStatus = status ?? "active";

  const client = new Client({
    _id: clientId,
    contactName,
    companyName,
    email,
    phone: phone || undefined,
    address,
    serviceTypes: cleanServiceTypes(serviceTypes),
    startDate,
    status: clientStatus,
    notes,
    user: userId,
    accountManager: accountManager || undefined,
    team,
    createdBy: requester._id,
  });
  const user = new User({
    _id: userId,
    fullName: contactName,
    companyName,
    email,
    phone: phone || undefined,
    address,
    role: "client",
    status: USER_STATUS_FOR[clientStatus],
    client: clientId,
    password,
  });

  // Validate both first so a bad request never leaves half a client behind.
  await client.validate();
  await user.validate();

  await user.save();
  try {
    await client.save();
  } catch (error) {
    await user.deleteOne();
    throw error;
  }

  return ApiResponse(res, 201, "Client created successfully", { client, user });
});

export const listClients = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const { q, status } = req.query as Record<string, string | undefined>;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const conditions: FilterQuery<IClient>[] = [scopeFor(requester)];
  if (status) conditions.push({ status });
  if (q) {
    const search = new RegExp(escapeRegex(q), "i");
    conditions.push({
      $or: [{ companyName: search }, { contactName: search }, { email: search }],
    });
  }
  const filter: FilterQuery<IClient> = { $and: conditions };

  // Counts per status across everything this user can see (ignores the search and
  // status filter), so the tabs and stat cards stay stable while filtering.
  const [clients, total, statusCounts] = await Promise.all([
    Client.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      // A list card has no use for the onboarding answers; they come with the single client.
      .select("-onboarding")
      .populate("accountManager", "fullName email avatar")
      .lean(),
    Client.countDocuments(filter),
    Client.aggregate<{ _id: ClientStatus; count: number }>([
      { $match: scopeFor(requester) },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const summary = Object.fromEntries(CLIENT_STATUSES.map((value) => [value, 0])) as Record<
    ClientStatus,
    number
  >;
  for (const { _id, count } of statusCounts) summary[_id] = count;

  return ApiResponse(res, 200, "Clients fetched successfully", {
    clients,
    summary: { total: Object.values(summary).reduce((sum, count) => sum + count, 0), ...summary },
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const getClient = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;

  const client = await Client.findOne({ $and: [{ _id: req.params.id }, scopeFor(requester)] })
    .populate("accountManager", "fullName email avatar role")
    .populate("team", "fullName email avatar role")
    .populate("user", "fullName email phone avatar status lastLoginAt");
  if (!client) throw new ApiError(404, "Client not found");

  return ApiResponse(res, 200, "Client fetched successfully", client);
});

export const updateClient = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const client = await findVisibleClient(requester, req.params.id);
  const loginUser = client.user ? await User.findById(client.user) : null;

  const {
    contactName,
    companyName,
    phone,
    address,
    serviceTypes,
    startDate,
    status,
    notes,
    accountManager,
    team,
  } = req.body;
  const email = req.body.email === undefined ? undefined : String(req.body.email).toLowerCase();

  if (email !== undefined && email !== client.email) {
    await assertEmailAvailable(email, { clientId: client._id, userId: loginUser?._id });
  }
  if (phone && phone !== client.phone) {
    await assertPhoneAvailable(phone, loginUser?._id);
  }
  await assertStaff([accountManager, ...(team ?? [])]);

  if (contactName !== undefined) client.contactName = contactName;
  if (companyName !== undefined) client.companyName = companyName;
  if (email !== undefined) client.email = email;
  if (phone !== undefined) client.phone = phone || undefined;
  if (address !== undefined) client.address = address;
  if (serviceTypes !== undefined) client.serviceTypes = cleanServiceTypes(serviceTypes);
  if (startDate !== undefined) client.startDate = startDate;
  if (status !== undefined) client.status = status;
  if (notes !== undefined) client.notes = notes;
  if (accountManager !== undefined) client.accountManager = accountManager || undefined;
  if (team !== undefined) client.team = team;

  // The login account mirrors the client's contact details.
  if (loginUser) {
    loginUser.fullName = client.contactName;
    loginUser.companyName = client.companyName;
    loginUser.email = client.email;
    loginUser.phone = client.phone;
    loginUser.address = client.address;
  }

  await client.validate();
  await loginUser?.validate();

  await client.save();
  await loginUser?.save();

  // Closing or pausing a client shuts every one of its logins, not just the main one.
  if (status !== undefined) {
    await User.updateMany({ client: client._id }, { status: USER_STATUS_FOR[client.status] });
  }

  return ApiResponse(res, 200, "Client updated successfully", client);
});

export const deleteClient = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const client = await findVisibleClient(requester, req.params.id);

  const users = await User.find({ client: client._id }).select("avatar");
  const userIds = users.map((user) => user._id);

  await User.deleteMany({ client: client._id });
  await RefreshToken.deleteMany({ user: { $in: userIds } });
  await client.deleteOne();

  // Best effort — an unreachable file store shouldn't fail the delete.
  await Promise.allSettled(users.map((user) => deleteFromSpaces(user.avatar)));

  return ApiResponse(res, 200, "Client deleted successfully");
});
