import crypto from "crypto";
import type { Request, Response } from "express";
import type { FilterQuery } from "mongoose";
import { Client, ONBOARDING_STATUSES, type IClient, type OnboardingStatus } from "../models/client.model";
import { User } from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { ONBOARDING_KEY_HEADER, ONBOARDING_SECTIONS } from "../validators/onboarding.validator";

// Onboarding, for someone who has no account yet. Nobody is signed in here, so these routes
// are open — and what keeps one visitor's answers from another is a key:
//
// Starting onboarding makes a client record with status "pending" and hands back a long random
// key, once. Reading, changing or deleting that onboarding afterwards needs the key, sent in
// the `x-onboarding-key` header; only its hash is stored. The key stops working as soon as the
// team takes the client on (the status leaves "pending"): from then on the record is theirs to
// change, through the staff routes.

type Plain = Record<string, unknown>;
const isPlainObject = (value: unknown): value is Plain => typeof value === "object" && value !== null && !Array.isArray(value);

const hashKey = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

const sameHash = (stored: string, given: string) => {
  const a = Buffer.from(stored);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// There is no public upload yet, so a visitor can't attach files: a `files` list sent here
// would only be URLs of their choosing, shown to staff as if we had stored them. Dropped,
// wherever in the answers it sits.
const withoutFiles = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutFiles);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "files")
      .map(([key, inner]) => [key, withoutFiles(inner)])
  );
};

// Puts the sections that were sent (under `answers`) onto the record. A section replaces what
// was there for it; one left out is untouched. Only the form's own sections are read — a
// visitor can't reach the rest of the client record (its status, its team) through here.
const applyAnswers = (client: IClient, body: Plain) => {
  if (!client.onboarding) client.set("onboarding", {});
  const answers = isPlainObject(body.answers) ? body.answers : {};
  for (const section of ONBOARDING_SECTIONS) {
    if (answers[section] !== undefined) client.set(`onboarding.${section}`, withoutFiles(answers[section]));
  }
  // `submit: true` hands it in; `submit: false` takes it back to keep working on it.
  if (body.submit === true) {
    client.set("onboarding.status", "submitted");
    client.set("onboarding.submittedAt", new Date());
  } else if (body.submit === false) {
    client.set("onboarding.status", "in_progress");
    client.set("onboarding.submittedAt", undefined);
  }
};

// What the visitor gets back: who they said they are, and their answers. Nothing internal.
const viewOf = (client: IClient) => ({
  id: client._id,
  contactName: client.contactName,
  companyName: client.companyName,
  email: client.email,
  phone: client.phone,
  onboarding: client.onboarding,
});

// The onboarding the request's key opens. One answer for "no such record", "not started
// through onboarding" and "wrong key", so an id can't be probed.
const findOwn = async (req: Request) => {
  const client = await Client.findById(req.params.id).select("+onboardingKeyHash");
  const given = hashKey(String(req.get(ONBOARDING_KEY_HEADER) ?? ""));
  if (!client?.onboardingKeyHash || !sameHash(client.onboardingKeyHash, given)) throw new ApiError(404, "Onboarding not found");
  if (client.status !== "pending") {
    throw new ApiError(409, "Your BayShore team has already picked this up. Sign in to your portal, or ask your account manager to make changes.");
  }
  return client;
};

// POST /onboarding — start (and optionally hand in) onboarding. Open to anyone.
export const startOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const { contactName, companyName, phone } = req.body;
  const email = String(req.body.email).toLowerCase();

  if ((await Client.exists({ email })) || (await User.exists({ email }))) {
    throw new ApiError(409, "This email already has a BayShore account. Sign in to your portal, or use a different email.");
  }

  const key = crypto.randomBytes(32).toString("hex");
  const client = new Client({
    contactName,
    companyName,
    email,
    phone: phone || undefined,
    // Chosen by the team when they take the client on.
    serviceTypes: [],
    startDate: new Date(),
    status: "pending",
    onboardingKeyHash: hashKey(key),
  });
  applyAnswers(client, req.body);
  await client.save();

  // The key is shown this once; without it the answers can't be opened again.
  return ApiResponse(res, 201, req.body.submit === true ? "Onboarding submitted" : "Onboarding saved", { ...viewOf(client), key });
});

// GET /onboarding/:id — the answers so far, to carry on with.
export const getOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const client = await findOwn(req);
  return ApiResponse(res, 200, "Onboarding fetched successfully", viewOf(client));
});

// PATCH /onboarding/:id — change answers (and the name, company or phone given with them).
export const updateOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const client = await findOwn(req);

  for (const field of ["contactName", "companyName"] as const) {
    if (req.body[field] !== undefined) client[field] = req.body[field];
  }
  if (req.body.phone !== undefined) client.phone = req.body.phone || undefined;
  applyAnswers(client, req.body);
  await client.save();

  return ApiResponse(res, 200, req.body.submit === true ? "Onboarding submitted" : "Onboarding saved", viewOf(client));
});

// DELETE /onboarding/:id — withdraw it. The pending record it made goes with it.
export const deleteOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const client = await findOwn(req);
  await client.deleteOne();
  return ApiResponse(res, 200, "Onboarding deleted successfully");
});

// ── For the team ─────────────────────────────────────────────────────────────

// An onboarding is a "request" while its client is still pending: someone came in through the
// form and nobody has taken them on yet. A pending client the team added themselves has no
// onboarding, and isn't one.
const waiting: FilterQuery<IClient> = { status: "pending", "onboarding.status": { $in: [...ONBOARDING_STATUSES] } };

// GET /onboarding/requests — the onboardings waiting to be taken on. Those handed in come
// first, newest first; then the ones still being filled in, by when they were last saved.
export const listOnboardingRequests = asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as OnboardingStatus | undefined;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const filter: FilterQuery<IClient> = status ? { ...waiting, "onboarding.status": status } : waiting;

  const [requests, total, counts] = await Promise.all([
    Client.find(filter)
      // "submitted" sorts after "in_progress", so descending puts the handed-in ones first.
      .sort({ "onboarding.status": -1, "onboarding.submittedAt": -1, updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("contactName companyName email phone onboarding.status onboarding.submittedAt createdAt updatedAt")
      .lean(),
    Client.countDocuments(filter),
    // Across all of them, whatever the filter — for the counts beside the list.
    Client.aggregate<{ _id: OnboardingStatus; count: number }>([{ $match: waiting }, { $group: { _id: "$onboarding.status", count: { $sum: 1 } } }]),
  ]);

  const summary = Object.fromEntries(ONBOARDING_STATUSES.map((value) => [value, 0])) as Record<OnboardingStatus, number>;
  for (const { _id, count } of counts) summary[_id] = count;

  return ApiResponse(res, 200, "Onboarding requests fetched successfully", {
    requests,
    summary: { total: summary.submitted + summary.in_progress, ...summary },
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// GET /onboarding/requests/:id — one onboarding in full: who sent it and every answer. Still
// readable after the client has been taken on, so the answers stay to work from.
export const getOnboardingRequest = asyncHandler(async (req: Request, res: Response) => {
  const client = await Client.findOne({ _id: req.params.id, "onboarding.status": { $in: [...ONBOARDING_STATUSES] } })
    .select("contactName companyName email phone status serviceTypes onboarding accountManager createdAt updatedAt")
    .populate("accountManager", "fullName")
    .lean();
  if (!client) throw new ApiError(404, "Onboarding request not found");

  return ApiResponse(res, 200, "Onboarding request fetched successfully", client);
});
