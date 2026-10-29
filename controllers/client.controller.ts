import mongoose, { type FilterQuery } from "mongoose";
import type { Request, Response } from "express";
import { Client, CLIENT_PORTAL_MENUS, CLIENT_STATUSES, portalMenusOf, ONBOARDING_MAX_COMPETITORS, ONBOARDING_TEXT_MAX_LENGTH, type IClient, type ClientStatus } from "../models/client.model";
import { User, type IUser, type UserStatus } from "../models/user.model";
import { RefreshToken } from "../models/refreshToken.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { clientScopeFor as scopeFor } from "../utils/clientAccess";
import { emailClientAdded, emailPortalLogin } from "../utils/activityEmails";
import { notifyOnboardingApproved, notifyServicesUpdated } from "../utils/notifications";
import { plansOf, stampPlans } from "../utils/clientServicePlans";
import { stepOfItem } from "../utils/onboardingUpdates";
import { unseal } from "../utils/secretBox";
import { removeClientData } from "../utils/clientCleanup";

// The roles that manage clients — the only ones shown a client's portal password.
const CAN_SEE_PASSWORD: string[] = ["assistant_manager", "manager", "admin", "superadmin"];

// A client's business status decides whether its logins may sign in.
const USER_STATUS_FOR: Record<ClientStatus, UserStatus> = {
  // They sign in to fill in the onboarding form.
  onboarding: "active",
  pending: "pending",
  active: "active",
  on_hold: "inactive",
  closed: "inactive",
};

// Trimmed, blanks dropped, duplicates removed (order kept).
const cleanServiceTypes = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

// The answers the onboarding form asks the client for too — their website, their profiles,
// their logo — when it is the team recording them on the add/edit form (sent as `shared`).
// Each is kept once, where the client's own answers go, so there is one answer whoever gave
// it last. A blank clears what was there, but doesn't start an onboarding record to do it.
const SHARED_SOCIALS = ["facebook", "instagram", "linkedin", "tiktok", "youtube", "x"] as const;

const applyShared = (client: IClient, shared: unknown) => {
  if (typeof shared !== "object" || shared === null || Array.isArray(shared)) return;
  const sent = shared as Record<string, unknown>;
  const put = (path: string, value: unknown) => {
    const next = typeof value === "string" ? value.trim() || undefined : value;
    if (next === undefined && client.get(`onboarding.${path}`) === undefined) return;
    client.set(`onboarding.${path}`, next);
  };

  if (typeof sent.website === "string") {
    put("website.url", sent.website);
    // A website given is a website had.
    if (sent.website.trim()) put("website.hasNone", undefined);
  }
  // A link given is an account had — as the client's own form says it — unless they answered already.
  const hasIt = (account: string, link: string) => {
    if (link.trim() && !client.get(`onboarding.${account}.has`)) put(`${account}.has`, "yes");
  };
  if (typeof sent.googleBusinessProfile === "string") {
    put("google.businessProfile.link", sent.googleBusinessProfile);
    hasIt("google.businessProfile", sent.googleBusinessProfile);
  }
  if (typeof sent.social === "object" && sent.social !== null) {
    const social = sent.social as Record<string, unknown>;
    for (const key of SHARED_SOCIALS) {
      const link = social[key];
      if (typeof link !== "string") continue;
      put(`social.${key}.link`, link);
      hasIt(`social.${key}`, link);
    }
  }
  if (typeof sent.hasLogo === "boolean") put("logo.has", sent.hasLogo ? "yes" : "no");
  if (typeof sent.logoStyle === "string") put("logo.style", sent.logoStyle);
  // The form lists competitor websites separated by commas. What the client said they like
  // about one stays with it.
  if (typeof sent.competitors === "string") {
    const kept: { url?: string; note?: string }[] = client.toObject().onboarding?.website?.competitors ?? [];
    const urls = Array.from(new Set(sent.competitors.split(",").map((url) => url.trim().slice(0, ONBOARDING_TEXT_MAX_LENGTH)).filter(Boolean)));
    const rows = urls.slice(0, ONBOARDING_MAX_COMPETITORS).map((url) => ({ url, note: kept.find((row) => row.url === url)?.note }));
    if (rows.length || kept.length) client.set("onboarding.website.competitors", rows);
  }
};

// The team's ticks over the client's onboarding form (sent as `onboardingControls`): what of it
// this client doesn't need — which their form then leaves out — and what the account manager has
// approved. Each list replaces the one before it. What isn't needed is kept even when it is
// empty — that is the team saying the client needs every step, where saying nothing leaves the
// portals' own starting list. Nothing approved doesn't start an onboarding record to say so.
const applyControls = (client: IClient, controls: unknown) => {
  if (typeof controls !== "object" || controls === null || Array.isArray(controls)) return;
  const sent = controls as Record<string, unknown>;
  for (const list of ["notNeeded", "approved"] as const) {
    if (!Array.isArray(sent[list])) continue;
    const ids = Array.from(new Set((sent[list] as unknown[]).filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean)));
    if (list === "approved" && !ids.length && !client.get("onboarding.approved")?.length) continue;
    const before: string[] = client.get(`onboarding.${list}`) ?? [];
    client.set(`onboarding.${list}`, ids);
    if (list !== "approved") continue;
    // An item approved needs no more updating — and one newly approved answers what was asked on its step.
    const newly = ids.filter((id) => !before.includes(id));
    const done = new Set([...ids, ...newly.map((id) => `step:${stepOfItem(id)}`)]);
    const asked: string[] = client.get("onboarding.updateAsked") ?? [];
    if (asked.some((id) => done.has(id))) client.set("onboarding.updateAsked", asked.filter((id) => !done.has(id)));
  }
};

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
 * Creates the client — and, when a password is sent, its portal login (role "client") in the
 * same call, filled in from the client's details. Without a password the client has no login:
 * the team looks after everything for them.
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
    portalMenus,
    details,
  } = req.body;
  const email = String(req.body.email).toLowerCase();
  const withLogin = Boolean(password);

  await assertEmailAvailable(email);
  // A phone number only has to be free when it is going to be a login's.
  if (withLogin) await assertPhoneAvailable(phone || undefined);
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
    portalMenus,
    details,
    user: withLogin ? userId : undefined,
    accountManager: accountManager || undefined,
    team,
    createdBy: requester._id,
  });
  // When each service was added (now), and when any already done was finished.
  stampPlans(client, []);
  applyShared(client, req.body.shared);
  applyControls(client, req.body.onboardingControls);
  const user = withLogin
    ? new User({
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
      })
    : null;

  // Validate both first so a bad request never leaves half a client behind.
  await client.validate();
  await user?.validate();

  await user?.save();
  try {
    await client.save();
  } catch (error) {
    await user?.deleteOne();
    throw error;
  }

  // A welcome to the client — with their sign-in email and password, when they were given a
  // login — and word to the staff put on it.
  await emailClientAdded(client, requester, withLogin ? password : undefined);

  return ApiResponse(res, 201, "Client created successfully", { client, user });
});

// GET /clients/me/portal — the pages of the portal the signed-in client is shown. A client
// the team hasn't chosen them for is shown every one.
export const getMyPortal = asyncHandler(async (req: Request, res: Response) => {
  const client = req.user?.client ? await Client.findById(req.user.client).select("portalMenus createdBy") : null;
  return ApiResponse(res, 200, "Portal fetched successfully", { menus: client ? portalMenusOf(client) : [...CLIENT_PORTAL_MENUS] });
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
      // The onboarding answers come along: each card shows how far through it the client is.
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

  // Those who manage clients are told whether the portal password can be read back — the password
  // itself only comes with the security code (getClientPortalPassword).
  const hasPortalPassword = CAN_SEE_PASSWORD.includes(requester.role) ? Boolean(await portalPasswordOf(client)) : undefined;

  return ApiResponse(res, 200, "Client fetched successfully", { ...client.toJSON(), hasPortalPassword });
});

// The client's portal password, readable. One set before it was kept readable — or sealed with
// another key — comes back as nothing.
const portalPasswordOf = async (client: IClient) => {
  if (!client.user) return undefined;
  const login = await User.findById(client.user).select("+passwordSealed").lean();
  try {
    return login?.passwordSealed ? unseal(login.passwordSealed) : undefined;
  } catch {
    return undefined;
  }
};

// GET /clients/:id/portal-password — behind the security code (routes: requireServicesUnlocked).
export const getClientPortalPassword = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  if (!CAN_SEE_PASSWORD.includes(requester.role)) throw new ApiError(403, "You do not have permission to perform this action");
  const client = await Client.findOne({ $and: [{ _id: req.params.id }, scopeFor(requester)] });
  if (!client) throw new ApiError(404, "Client not found");
  const password = await portalPasswordOf(client);
  if (!password) throw new ApiError(404, "No portal password to show");
  return ApiResponse(res, 200, "Password fetched", { password });
});

export const updateClient = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const client = await findVisibleClient(requester, req.params.id);
  let loginUser = client.user ? await User.findById(client.user) : null;

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
    portalMenus,
    details,
    password,
  } = req.body;
  const email = req.body.email === undefined ? undefined : String(req.body.email).toLowerCase();

  if (email !== undefined && email !== client.email) {
    await assertEmailAvailable(email, { clientId: client._id, userId: loginUser?._id });
  }
  if (phone && phone !== client.phone) {
    await assertPhoneAvailable(phone, loginUser?._id);
  }
  // A password can also give portal access to a client that was originally created without it.
  if (password && !loginUser) {
    await assertEmailAvailable(email ?? client.email, { clientId: client._id });
    await assertPhoneAvailable(phone ?? client.phone);
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
  if (portalMenus !== undefined) client.portalMenus = portalMenus;
  // The form sends everything it holds, so what is sent replaces what was there. Each service
  // keeps when it was added and finished, and the client hears what changed (below).
  const plansBefore = plansOf(client);
  if (details !== undefined) client.set("details", details);
  const serviceChanges = details !== undefined ? stampPlans(client, plansBefore) : undefined;
  applyShared(client, req.body.shared);
  const approvedBefore = new Set<string>(client.onboarding?.approved ?? []);
  applyControls(client, req.body.onboardingControls);
  const newlyApproved = (client.onboarding?.approved ?? []).filter((id) => !approvedBefore.has(id)).length;
  // The client's requests the team answered on the form: added as a service, or set aside.
  const openBefore = new Set(client.serviceRequests.filter((request) => request.status === "open").map((request) => String(request._id)));
  for (const [list, status] of [["serviceRequestsAdded", "added"], ["serviceRequestsDismissed", "dismissed"]] as const) {
    const ids: unknown = req.body[list];
    if (!Array.isArray(ids)) continue;
    for (const request of client.serviceRequests) if (ids.includes(String(request._id))) request.status = status;
  }
  // …and one whose service is on the client now, by its name, is answered too.
  const named = (name: string) => name.trim().toLowerCase();
  const onRecord = new Set([...(client.details?.services ?? []).map((plan) => named(plan.name)), ...(client.serviceTypes ?? []).map(named)]);
  for (const request of client.serviceRequests) if (request.status === "open" && onRecord.has(named(request.name))) request.status = "added";
  // Set aside just now: the client hears it with their services.
  const declined = client.serviceRequests.filter((request) => request.status === "dismissed" && openBefore.has(String(request._id))).map((request) => request.name);
  if (accountManager !== undefined) client.accountManager = accountManager || undefined;
  if (team !== undefined) client.team = team;

  // Whether this save gives the client their first login (rather than a new password).
  const loginCreated = Boolean(password && !loginUser);
  if (password && !loginUser) {
    loginUser = new User({
      fullName: client.contactName,
      companyName: client.companyName,
      email: client.email,
      phone: client.phone,
      address: client.address,
      role: "client",
      status: USER_STATUS_FOR[client.status],
      client: client._id,
      password,
    });
    client.user = loginUser._id;
  }

  // The login account mirrors the client's contact details.
  if (loginUser) {
    loginUser.fullName = client.contactName;
    loginUser.companyName = client.companyName;
    loginUser.email = client.email;
    loginUser.phone = client.phone;
    loginUser.address = client.address;
    if (password) loginUser.password = password;
  }

  await client.validate();
  await loginUser?.validate();

  await client.save();
  await loginUser?.save();

  // A replaced password invalidates any sessions authenticated with the old one.
  if (password && loginUser) await RefreshToken.deleteMany({ user: loginUser._id });
  // The client gets the way in: their sign-in email and the password just set.
  if (password && loginUser) await emailPortalLogin(client, password, loginCreated);
  // Items the team just approved on the client's onboarding: the client hears at once.
  if (newlyApproved) await notifyOnboardingApproved(client._id, requester, newlyApproved);
  // A service added, finished, changed or taken off: the client hears at once.
  if (serviceChanges || declined.length) await notifyServicesUpdated(client._id, requester, { ...(serviceChanges ?? { added: [], done: [], changed: [], removed: [] }), declined });

  // Closing or pausing a client shuts every one of its logins, not just the main one.
  if (status !== undefined) {
    await User.updateMany({ client: client._id }, { status: USER_STATUS_FOR[client.status] });
  }

  return ApiResponse(res, 200, "Client updated successfully", client);
});

export const deleteClient = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const client = await findVisibleClient(requester, req.params.id);

  // The client and everything kept for it: logins, content, comments, messages, files…
  await removeClientData([client._id]);

  return ApiResponse(res, 200, "Client deleted successfully");
});
