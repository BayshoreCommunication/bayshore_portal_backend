import crypto from "crypto";
import type { Request, Response } from "express";
import type { FilterQuery } from "mongoose";
import {
  Client,
  ONBOARDING_MEDIA_KINDS,
  ONBOARDING_MEDIA_MAX_FILES,
  ONBOARDING_MEDIA_MAX_FILE_SIZE,
  ONBOARDING_MEDIA_MIME_TYPES,
  ONBOARDING_STATUSES,
  type IClient,
  type IOnboardingFile,
  type OnboardingMediaKind,
  type OnboardingUploadKind,
  type OnboardingStatus,
} from "../models/client.model";
import { User } from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { ONBOARDING_KEY_HEADER, ONBOARDING_SECTIONS } from "../validators/onboarding.validator";
import { seal } from "../utils/secretBox";
import { deleteFromSpaces, uploadToSpaces } from "../utils/uploadToSpaces";

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

// The sections made of accounts (Google, social media), where a login may be shared.
const ACCOUNT_SECTIONS: readonly string[] = ["google", "social"];
const PASSWORD_MAX_LENGTH = 200;

// An account's password comes in as typed (`loginPassword`) and is sealed before it is stored.
// It is never sent back (see viewOf), so the form can't send it again with its other answers:
// an account that arrives without one keeps the one it had — for as long as its login is
// still what is being shared. Any other way of giving access drops it.
const withPasswords = (client: IClient, section: string, incoming: unknown): unknown => {
  if (!isPlainObject(incoming)) return incoming;
  return Object.fromEntries(
    Object.entries(incoming).map(([name, account]) => {
      if (!isPlainObject(account)) return [name, account];
      const { loginPassword: typed, loginPasswordSet: _never, ...rest } = account;
      if (rest.access !== "secure") return [name, rest];
      if (typeof typed === "string" && typed !== "") {
        if (typed.length > PASSWORD_MAX_LENGTH) throw new ApiError(422, `A password cannot exceed ${PASSWORD_MAX_LENGTH} characters`);
        return [name, { ...rest, loginPassword: seal(typed) }];
      }
      const kept: unknown = client.get(`onboarding.${section}.${name}.loginPassword`);
      return [name, typeof kept === "string" && kept ? { ...rest, loginPassword: kept } : rest];
    })
  );
};

// The answers as they go back to whoever gave them: a stored password is left out, with only
// the fact that there is one (`loginPasswordSet`) in its place.
const withoutPasswords = (client: IClient) => {
  const onboarding = client.toObject().onboarding as (Plain & IClient["onboarding"]) | undefined;
  if (!onboarding) return onboarding;
  for (const section of ACCOUNT_SECTIONS) {
    const accounts = onboarding[section];
    if (!isPlainObject(accounts)) continue;
    for (const account of Object.values(accounts)) {
      if (!isPlainObject(account) || !account.loginPassword) continue;
      delete account.loginPassword;
      account.loginPasswordSet = true;
    }
  }
  return onboarding;
};

// The files stored for one kind of photos or videos, as plain objects.
// Where one kind of upload is kept on the record: the logo with the logo's answers, the rest with the media.
const filesPathOf = (kind: OnboardingUploadKind) => (kind === "logo" ? "onboarding.logo.files" : `onboarding.media.${kind}.files`);
const mediaFilesOf = (client: IClient, kind: OnboardingUploadKind): IOnboardingFile[] => {
  const onboarding = client.toObject().onboarding;
  return (kind === "logo" ? onboarding?.logo?.files : onboarding?.media?.[kind]?.files) ?? [];
};

// Meta Ads is asked about when a client signs up, but isn't on the onboarding form. So when
// the form saves the social accounts — the whole section, as it does — that answer stays.
const withKeptAccounts = (client: IClient, section: string, incoming: unknown): unknown => {
  if (section !== "social" || !isPlainObject(incoming) || "metaAds" in incoming) return incoming;
  const kept = client.toObject().onboarding?.social?.metaAds;
  return kept ? { ...incoming, metaAds: kept } : incoming;
};

// Uploaded photos and videos come in through their own route (uploadMyOnboardingMedia), not
// with the answers — the form doesn't send them, and `withoutFiles` drops any it is sent. So
// when the media section is saved, each kind keeps the files it already has.
const withStoredFiles = (client: IClient, incoming: unknown): unknown => {
  const sent = isPlainObject(incoming) ? incoming : {};
  return Object.fromEntries(
    ONBOARDING_MEDIA_KINDS.flatMap((kind) => {
      const files = mediaFilesOf(client, kind);
      const answer = sent[kind];
      if (!isPlainObject(answer)) return files.length ? [[kind, { files }]] : [];
      return [[kind, { ...answer, files }]];
    })
  );
};

// Puts the sections that were sent (under `answers`) onto the record. A section replaces what
// was there for it; one left out is untouched. Only the form's own sections are read — a
// visitor can't reach the rest of the client record (its status, its team) through here.
const applyAnswers = (client: IClient, body: Plain) => {
  if (!client.onboarding) client.set("onboarding", {});
  // The client is on the form now, whatever of it the team had recorded before.
  if (!client.get("onboarding.status")) client.set("onboarding.status", "in_progress");
  const answers = isPlainObject(body.answers) ? body.answers : {};
  for (const section of ONBOARDING_SECTIONS) {
    if (answers[section] === undefined) continue;
    const sent = withoutFiles(answers[section]);
    client.set(
      `onboarding.${section}`,
      ACCOUNT_SECTIONS.includes(section)
        ? withKeptAccounts(client, section, withPasswords(client, section, sent))
        : section === "media"
          ? withStoredFiles(client, sent)
          : // The logo's files are uploaded on their own too: saving its answers keeps them.
            section === "logo" && isPlainObject(sent)
            ? { ...sent, files: mediaFilesOf(client, "logo") }
            : sent
    );
  }
  // `submit: true` hands it in; `submit: false` takes it back to keep working on it.
  if (body.submit === true) {
    client.set("onboarding.status", "submitted");
    client.set("onboarding.submittedAt", new Date());
    // Handing the form in — every question answered — is the end of onboarding: a client who
    // was in it is active from here on. (Their logins are active already.)
    if (client.status === "onboarding") client.status = "active";
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
  onboarding: withoutPasswords(client),
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

// ── For a client who is signed in ────────────────────────────────────────────

// A client with an account needs no key: their login says whose record it is. So they can open
// the form already filled in with what we hold on them, and their answers are saved on that
// same record — whatever its status, since it is their own.
const findMine = async (req: Request) => {
  const client = req.user?.client ? await Client.findById(req.user.client) : null;
  if (!client) throw new ApiError(404, "There is no client record for this account");
  return client;
};

// GET /onboarding/me — who they are and their answers so far, to fill the form with.
export const getMyOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const client = await findMine(req);
  return ApiResponse(res, 200, "Onboarding fetched successfully", viewOf(client));
});

// PATCH /onboarding/me — change answers (and the name, company or phone given with them).
export const updateMyOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const client = await findMine(req);
  const login = req.user!;

  for (const field of ["contactName", "companyName"] as const) {
    if (req.body[field] !== undefined) client[field] = req.body[field];
  }
  if (req.body.phone !== undefined) {
    const phone: string | undefined = req.body.phone || undefined;
    if (phone && phone !== login.phone && (await User.exists({ phone, _id: { $ne: login._id } }))) {
      throw new ApiError(409, "This phone number is already used by another BayShore account");
    }
    client.phone = phone;
  }
  applyAnswers(client, req.body);

  // The client's main login mirrors its contact details, as when the team edits them
  // (client.controller.ts → updateClient). Another login of the same client is left as it is.
  const isMainLogin = String(client.user) === String(login._id);
  if (isMainLogin) {
    login.fullName = client.contactName;
    login.companyName = client.companyName;
    login.phone = client.phone;
  }

  // Validate both first so a bad answer never leaves the two out of step.
  await client.validate();
  if (isMainLogin) await login.validate();

  await client.save();
  if (isMainLogin) await login.save();

  return ApiResponse(res, 200, req.body.submit === true ? "Onboarding submitted" : "Onboarding saved", viewOf(client));
});

const uploadedFilesOf = (req: Request) => ((req.files ?? {}) as Record<string, Express.Multer.File[]>).files ?? [];

// What each kind of upload takes, said to the client when a file isn't one of them.
const UPLOAD_FORMATS: Record<OnboardingUploadKind, string> = {
  professionalPhotos: "JPG, PNG, WEBP or GIF photos",
  businessPhotos: "JPG, PNG, WEBP or GIF photos",
  videos: "MP4, MOV or WEBM videos",
  logo: "PNG, JPG, WEBP, GIF or SVG images",
};

// POST /onboarding/me/media/:kind — add photos or videos of one kind, or logo files. They go to DigitalOcean
// Spaces, and are listed on the client's record with the rest of their onboarding.
export const uploadMyOnboardingMedia = asyncHandler(async (req: Request, res: Response) => {
  const client = await findMine(req);
  const kind = req.params.kind as OnboardingUploadKind;
  const incoming = uploadedFilesOf(req);
  if (!incoming.length) throw new ApiError(422, "Choose at least one file to upload");

  // Each kind takes its own type of file, up to its own size.
  for (const file of incoming) {
    if (!ONBOARDING_MEDIA_MIME_TYPES[kind].includes(file.mimetype)) {
      throw new ApiError(422, `${file.originalname} can't go here — ${UPLOAD_FORMATS[kind]} only`);
    }
    if (file.size > ONBOARDING_MEDIA_MAX_FILE_SIZE[kind]) {
      throw new ApiError(422, `${file.originalname} is too large — up to ${ONBOARDING_MEDIA_MAX_FILE_SIZE[kind] / (1024 * 1024)}MB each`);
    }
  }
  const stored = mediaFilesOf(client, kind);
  if (stored.length + incoming.length > ONBOARDING_MEDIA_MAX_FILES) {
    throw new ApiError(422, `That is too many — up to ${ONBOARDING_MEDIA_MAX_FILES} files here, and ${stored.length} are already uploaded`);
  }

  const added: IOnboardingFile[] = [];
  try {
    for (const file of incoming) {
      const url = await uploadToSpaces(file, `onboarding/${client._id}`);
      added.push({ url, name: file.originalname, size: file.size, mimeType: file.mimetype });
    }
    if (!client.onboarding) client.set("onboarding", {});
    if (!client.get("onboarding.status")) client.set("onboarding.status", "in_progress");
    client.set(filesPathOf(kind), [...stored, ...added]);
    // Uploading is choosing "share what I have" — or, for a logo, saying there is one.
    if (kind === "logo") client.set("onboarding.logo.has", "yes");
    else client.set(`onboarding.media.${kind}.mode`, "upload");
    await client.save();
  } catch (error) {
    // Nothing half-done: what reached Spaces but couldn't be recorded is taken out again.
    await Promise.all(added.map((file) => deleteFromSpaces(file.url).catch(() => undefined)));
    throw error;
  }

  return ApiResponse(res, 201, incoming.length === 1 ? "File uploaded" : "Files uploaded", { files: mediaFilesOf(client, kind) });
});

// DELETE /onboarding/me/media/:kind — take one uploaded file back. Its URL comes in the body.
export const removeMyOnboardingMedia = asyncHandler(async (req: Request, res: Response) => {
  const client = await findMine(req);
  const kind = req.params.kind as OnboardingUploadKind;
  const url = String(req.body.url);

  const stored = mediaFilesOf(client, kind);
  if (!stored.some((file) => file.url === url)) throw new ApiError(404, "File not found");

  client.set(filesPathOf(kind), stored.filter((file) => file.url !== url));
  await client.save();
  // Off the record first: a file left behind in Spaces is tidier than a listed one that is gone.
  await deleteFromSpaces(url).catch(() => undefined);

  return ApiResponse(res, 200, "File removed", { files: mediaFilesOf(client, kind) });
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
