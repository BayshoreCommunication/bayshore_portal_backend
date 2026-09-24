import type { Request, Response } from "express";
import type { FilterQuery } from "mongoose";
import {
  Content,
  CONTENT_KIND_RULES,
  CONTENT_MAX_FILES,
  CONTENT_STATUSES,
  MEDIA_MAX_FILE_SIZE,
  mediaOfMimeType,
  type ContentStatus,
  type ContentType,
  type IContent,
  type IContentFile,
} from "../models/content.model";
import { Client } from "../models/client.model";
import type { IUser } from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { canAccessClient, clientScopeFor, visibleClientFilter } from "../utils/clientAccess";
import { CONTENT_REVIEW_ROLES } from "../utils/contentAccess";
import { uploadToSpaces, deleteFromSpaces } from "../utils/uploadToSpaces";

const isReviewer = (user: IUser) => CONTENT_REVIEW_ROLES.includes(user.role);

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const titleMatch = (q: string) => ({ title: new RegExp(escapeRegex(q), "i") });

const pagingOf = (req: Request) => ({
  page: Number(req.query.page) || 1,
  limit: Number(req.query.limit) || 20,
});

const toBool = (value: unknown) => value === true || value === "true";

// A list that arrives as a real array (JSON body) or, from a multipart form, as a
// JSON string or a comma-separated string.
const parseList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch {
    // Not JSON — fall through to comma-splitting.
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
};

const findVisibleContent = async (requester: IUser, id: string) => {
  const content = await Content.findById(id);
  // Same answer whether it doesn't exist or belongs to a client you can't see.
  if (!content || !(await canAccessClient(requester, content.client))) {
    throw new ApiError(404, "Content not found");
  }
  return content;
};

// A batch-type filter that also finds older records, saved before batchType existed —
// those count as individual or monthly by their isIndividual flag.
const batchTypeFilter = (batchType: string): FilterQuery<IContent> => {
  if (batchType === "monthly") return { $or: [{ batchType: "monthly" }, { batchType: { $exists: false }, isIndividual: { $ne: true } }] };
  if (batchType === "individual") return { $or: [{ batchType: "individual" }, { batchType: { $exists: false }, isIndividual: true }] };
  return { batchType };
};

const requireClientAccount = (user: IUser) => {
  if (!user.client) throw new ApiError(403, "This account is not linked to a client");
  return user.client;
};

// Mongoose validation messages, as a flat list — for "piece 2: …" style errors.
const validationMessages = (error: unknown): string[] => {
  const errors = (error as { errors?: Record<string, { message: string }> })?.errors;
  return errors ? Object.values(errors).map((item) => item.message) : [(error as Error)?.message ?? "Invalid content"];
};

// ── Files ────────────────────────────────────────────────────────────────────

// Files from a single-piece request: `files` (up to CONTENT_MAX_FILES), or the older single `file`.
const uploadedFilesOf = (req: Request): Express.Multer.File[] => {
  const fields = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  return [...(fields.files ?? []), ...(fields.file ?? [])];
};

// Check each file against what this content type accepts and its media's size cap,
// before anything is uploaded. Returns the file's media alongside it.
const checkFiles = (type: ContentType, files: Express.Multer.File[]) => {
  const rules = CONTENT_KIND_RULES[type];
  return files.map((file) => {
    const media = mediaOfMimeType(file.mimetype);
    if (!media || !rules.media.includes(media)) {
      throw new ApiError(422, `"${file.originalname}" can't be used for ${type} content (${rules.media.join(" or ")} only)`);
    }
    if (file.size > MEDIA_MAX_FILE_SIZE[media]) {
      throw new ApiError(422, `"${file.originalname}" is too large (max ${MEDIA_MAX_FILE_SIZE[media] / (1024 * 1024)}MB for ${media})`);
    }
    return { file, media };
  });
};

// Send checked files to DigitalOcean Spaces. If one fails, the ones already sent are removed.
const uploadFiles = async (type: ContentType, checked: ReturnType<typeof checkFiles>): Promise<IContentFile[]> => {
  const uploaded: IContentFile[] = [];
  try {
    for (const { file, media } of checked) {
      const url = await uploadToSpaces(file, `content/${type}`);
      uploaded.push({ url, name: file.originalname, size: file.size, mimeType: file.mimetype, media });
    }
    return uploaded;
  } catch (error) {
    await removeFiles(uploaded.map((file) => file.url));
    throw error;
  }
};

// Files attached to a comment: any media, each within its size cap, sent to Spaces.
const uploadCommentFiles = async (req: Request): Promise<IContentFile[]> => {
  const files = ((req.files ?? {}) as Record<string, Express.Multer.File[]>).files ?? [];
  const checked = files.map((file) => {
    const media = mediaOfMimeType(file.mimetype);
    if (!media) throw new ApiError(422, `"${file.originalname}" isn't a supported file type`);
    if (file.size > MEDIA_MAX_FILE_SIZE[media]) {
      throw new ApiError(422, `"${file.originalname}" is too large (max ${MEDIA_MAX_FILE_SIZE[media] / (1024 * 1024)}MB for ${media})`);
    }
    return { file, media };
  });
  const uploaded: IContentFile[] = [];
  try {
    for (const { file, media } of checked) {
      const url = await uploadToSpaces(file, "content/comments");
      uploaded.push({ url, name: file.originalname, size: file.size, mimeType: file.mimetype, media });
    }
    return uploaded;
  } catch (error) {
    await removeFiles(uploaded.map((file) => file.url));
    throw error;
  }
};

// Save after adding a comment; if that fails, its attachments are removed again.
const saveWithAttachments = async (content: IContent, attachments: IContentFile[]) => {
  try {
    await content.save();
  } catch (error) {
    await removeFiles(attachments.map((file) => file.url));
    throw error;
  }
};

const removeFiles = (urls: (string | undefined)[]) => Promise.all(urls.map((url) => deleteFromSpaces(url).catch(() => undefined)));

// An older record kept its one file in imageUrl / videoUrl / docUrl. Before editing
// its files, carry that file over into `files` so nothing is lost.
const adoptLegacyFile = (content: IContent) => {
  if (content.files.length) return;
  const url = content.type === "image" ? content.imageUrl : content.type === "video" ? content.videoUrl : content.type === "blog" ? content.docUrl : undefined;
  // A pasted link (not a Spaces upload) stays a link.
  if (!url || /^https?:\/\/(www\.)?(youtube|youtu\.be|vimeo|docs\.google|drive\.google)/i.test(url)) {
    if (url && !content.link) content.link = url;
    return;
  }
  const media = content.type === "image" ? "image" : content.type === "video" ? "video" : "doc";
  content.files.push({ url, name: content.docName ?? content.title, size: 0, mimeType: "", media });
};

// ── Details ──────────────────────────────────────────────────────────────────

// Batch fields shared by every piece in a batch.
const applyBatch = (content: IContent, body: Record<string, unknown>) => {
  if (body.batchMonth !== undefined) content.batchMonth = body.batchMonth as string;
  if (body.batchType !== undefined) content.batchType = body.batchType as IContent["batchType"];
  // Older callers only send isIndividual.
  else if (body.isIndividual !== undefined) content.batchType = toBool(body.isIndividual) ? "individual" : "monthly";
  if (body.weekStart !== undefined) content.weekStart = body.weekStart ? new Date(body.weekStart as string) : undefined;
  if (body.eventName !== undefined) content.eventName = body.eventName as string;
  if (body.eventDate !== undefined) content.eventDate = body.eventDate ? new Date(body.eventDate as string) : undefined;
  if (body.sentReason !== undefined) content.sentReason = body.sentReason as string;
};

// The piece's own fields.
const applyDetails = (content: IContent, body: Record<string, unknown>) => {
  if (body.title !== undefined) content.title = body.title as string;
  if (body.caption !== undefined) content.caption = body.caption as string;
  if (body.link !== undefined) content.link = body.link as string;
  // Older callers send the pasted link as videoUrl / docUrl.
  else if (body.videoUrl !== undefined || body.docUrl !== undefined) content.link = (body.videoUrl ?? body.docUrl) as string;
  for (const field of ["pageName", "pageUrl", "subject", "headline", "cta", "imageAlt", "docName", "docTitle"] as const) {
    if (body[field] !== undefined) content[field] = body[field] as string;
  }
  if (body.tags !== undefined) content.tags = parseList(body.tags);
};

// ── Staff (company-portal) ───────────────────────────────────────────────────

const checkClient = async (requester: IUser, clientId: unknown) => {
  const client = await Client.exists({ $and: [{ _id: clientId }, clientScopeFor(requester)] });
  if (!client) throw new ApiError(404, "Client not found");
};

// One piece, with up to CONTENT_MAX_FILES files. Saved as a draft, or sent to the
// client straight away with status "pending_approval".
export const createContent = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const { client: clientId, type, status = "draft" } = req.body;
  await checkClient(requester, clientId);

  // Set here rather than left to the save hook's request context, which a multipart upload can lose.
  const content = new Content({ client: clientId, type, status, createdBy: requester._id });
  applyBatch(content, req.body);
  applyDetails(content, req.body);

  const checked = checkFiles(type, uploadedFilesOf(req));
  // Check everything else before sending files anywhere: validate against placeholders.
  content.files = checked.map(({ file, media }) => ({ url: "pending", name: file.originalname, size: file.size, mimeType: file.mimetype, media }));
  await content.validate().catch((error) => {
    throw new ApiError(422, "Content is incomplete", validationMessages(error));
  });

  content.files = await uploadFiles(type, checked);
  try {
    await content.save();
  } catch (error) {
    await removeFiles(content.files.map((file) => file.url));
    throw error;
  }

  await content.populate("createdBy", "fullName");
  return ApiResponse(res, 201, status === "draft" ? "Content saved as a draft" : "Content sent for approval", content);
});

// Several pieces for one client and batch, in one request — what the Add Content
// page sends. Shared batch fields sit in the body; `pieces` is a JSON array of each
// piece's own fields; each piece's files arrive under `files[<index>]`. Nothing is
// saved unless every piece is complete.
export const createContentBatch = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const { client: clientId, status = "draft" } = req.body;
  await checkClient(requester, clientId);

  const pieces = req.body.pieces as Record<string, unknown>[];
  const uploads = (req.files ?? []) as Express.Multer.File[];
  const filesOf = (index: number) => uploads.filter((file) => file.fieldname === `files[${index}]`);

  const stray = uploads.find((file) => !/^files\[\d+\]$/.test(file.fieldname) || Number(file.fieldname.slice(6, -1)) >= pieces.length);
  if (stray) throw new ApiError(422, `File "${stray.originalname}" isn't attached to a piece (field "${stray.fieldname}")`);

  // Build and check every piece before uploading anything.
  const problems: string[] = [];
  const prepared = await Promise.all(
    pieces.map(async (piece, index) => {
      const type = piece.type as ContentType;
      const content = new Content({ client: clientId, type, status, createdBy: requester._id });
      applyBatch(content, req.body);
      applyDetails(content, piece);

      let checked: ReturnType<typeof checkFiles> = [];
      try {
        checked = checkFiles(type, filesOf(index));
      } catch (error) {
        problems.push(`Piece ${index + 1}: ${(error as Error).message}`);
      }
      content.files = checked.map(({ file, media }) => ({ url: "pending", name: file.originalname, size: file.size, mimeType: file.mimetype, media }));
      await content.validate().catch((error) => {
        for (const message of validationMessages(error)) problems.push(`Piece ${index + 1}: ${message}`);
      });
      return { content, checked };
    })
  );
  if (problems.length) throw new ApiError(422, `${pieces.length === 1 ? "The piece is" : "Some pieces are"} incomplete`, problems);

  const sent: string[] = [];
  try {
    for (const { content, checked } of prepared) {
      content.files = await uploadFiles(content.type, checked);
      sent.push(...content.files.map((file) => file.url));
    }
    // One at a time, so the audit log and the save hooks run for each piece.
    for (const { content } of prepared) await content.save();
  } catch (error) {
    await Content.deleteMany({ _id: { $in: prepared.map(({ content }) => content._id) } });
    await removeFiles(sent);
    throw error;
  }

  const items = prepared.map(({ content }) => content);
  await Content.populate(items, { path: "createdBy", select: "fullName" });
  return ApiResponse(
    res,
    201,
    `${items.length} ${items.length === 1 ? "piece" : "pieces"} ${status === "draft" ? "saved as drafts" : "sent for approval"}`,
    { items }
  );
});

export const listContent = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const { client, type, status, batchMonth, batchType, individual, q } = req.query as Record<string, string | undefined>;
  const { page, limit } = pagingOf(req);

  const scope = await visibleClientFilter(requester);

  const conditions: FilterQuery<IContent>[] = [scope];
  if (client) conditions.push({ client });
  if (type) conditions.push({ type });
  if (status) conditions.push({ status });
  if (batchMonth) conditions.push({ batchMonth });
  if (batchType) conditions.push(batchTypeFilter(batchType));
  if (individual !== undefined) conditions.push({ isIndividual: individual === "true" });
  if (q) conditions.push(titleMatch(q));
  const filter: FilterQuery<IContent> = { $and: conditions };

  const [items, total, statusCounts] = await Promise.all([
    Content.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("client", "companyName contactName")
      .populate("createdBy approvedBy comments.user", "fullName")
      .lean(),
    Content.countDocuments(filter),
    // Across everything this person can see, ignoring the filters — for tabs and badges.
    Content.aggregate<{ _id: ContentStatus; count: number }>([
      { $match: scope },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const summary = Object.fromEntries(CONTENT_STATUSES.map((value) => [value, 0])) as Record<ContentStatus, number>;
  for (const { _id, count } of statusCounts) summary[_id] = count;

  return ApiResponse(res, 200, "Content fetched successfully", {
    items,
    summary: { total: Object.values(summary).reduce((sum, count) => sum + count, 0), ...summary },
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const getContent = asyncHandler(async (req: Request, res: Response) => {
  const content = await findVisibleContent(req.user!, req.params.id);
  await content.populate([
    { path: "client", select: "companyName contactName" },
    { path: "createdBy approvedBy comments.user", select: "fullName" },
  ]);

  return ApiResponse(res, 200, "Content fetched successfully", content);
});

// Change a piece's details, add files (`files`), and drop files by URL (`removeFiles`).
export const updateContent = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const content = await findVisibleContent(requester, req.params.id);

  if (content.status === "approved" && !isReviewer(requester)) {
    throw new ApiError(403, "This item is already approved. Ask a manager to send it back to draft first.");
  }

  adoptLegacyFile(content);
  applyBatch(content, req.body);
  applyDetails(content, req.body);

  const dropped = parseList(req.body.removeFiles);
  const kept = content.files.filter((file) => !dropped.includes(file.url));
  const checked = checkFiles(content.type, uploadedFilesOf(req));
  if (kept.length + checked.length > CONTENT_MAX_FILES) {
    throw new ApiError(422, `A piece can have at most ${CONTENT_MAX_FILES} files`);
  }

  content.files = [
    ...kept,
    ...checked.map(({ file, media }) => ({ url: "pending", name: file.originalname, size: file.size, mimeType: file.mimetype, media })),
  ];
  await content.validate().catch((error) => {
    throw new ApiError(422, "Content is incomplete", validationMessages(error));
  });

  const added = await uploadFiles(content.type, checked);
  content.files = [...kept, ...added];
  try {
    await content.save();
  } catch (error) {
    await removeFiles(added.map((file) => file.url));
    throw error;
  }
  await removeFiles(dropped);

  return ApiResponse(res, 200, "Content updated successfully", content);
});

// draft → pending_approval (and revision_requested → pending_approval, once the
// feedback has been addressed) is the normal writer move. Everything else —
// approving or requesting a revision on the client's behalf, or sending an
// already-sent item back to draft — is for managers.
export const changeContentStatus = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const target: ContentStatus = req.body.status;
  const content = await findVisibleContent(requester, req.params.id);
  const current = content.status;

  if (target === current) throw new ApiError(400, `This content is already ${current}`);

  const canResend = (current === "draft" || current === "revision_requested") && target === "pending_approval";
  if (!isReviewer(requester) && !canResend) {
    throw new ApiError(403, "You can send a draft (or revised item) for approval; other moves are for managers");
  }

  content.status = target;
  await content.save();

  return ApiResponse(res, 200, `Content is now ${target}`, content);
});

// Superadmin only (see the route), in any status.
export const deleteContent = asyncHandler(async (req: Request, res: Response) => {
  const content = await findVisibleContent(req.user!, req.params.id);

  await content.deleteOne();
  // deleteFromSpaces ignores anything that isn't a Spaces URL (e.g. a pasted link).
  await removeFiles([
    ...content.files.map((file) => file.url),
    ...content.comments.flatMap((entry) => (entry.attachments ?? []).map((file) => file.url)),
    content.imageUrl,
    content.videoUrl,
    content.docUrl,
  ]);

  return ApiResponse(res, 200, "Content deleted successfully");
});

// A team reply on the thread — doesn't move the status; the account manager
// sends the item back for approval separately once it's actually addressed.
export const addContentComment = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const content = await findVisibleContent(requester, req.params.id);

  const attachments = await uploadCommentFiles(req);
  content.comments.push({
    author: "team",
    user: requester._id,
    name: requester.fullName,
    text: req.body.text ?? "",
    attachments,
    createdAt: new Date(),
  });
  await saveWithAttachments(content, attachments);

  return ApiResponse(res, 200, "Comment added", content);
});

// ── The client's own portal: their own company's sent content only ──────────

export const listMyContent = asyncHandler(async (req: Request, res: Response) => {
  const clientId = requireClientAccount(req.user!);
  const { batchMonth, batchType, individual } = req.query as Record<string, string | undefined>;
  const { page, limit } = pagingOf(req);

  const conditions: FilterQuery<IContent>[] = [{ client: clientId, status: { $ne: "draft" } }];
  if (batchMonth) conditions.push({ batchMonth });
  if (batchType) conditions.push(batchTypeFilter(batchType));
  if (individual !== undefined) conditions.push({ isIndividual: individual === "true" });
  const filter: FilterQuery<IContent> = { $and: conditions };

  const [items, total, months] = await Promise.all([
    Content.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("createdBy approvedBy comments.user", "fullName")
      .lean(),
    Content.countDocuments(filter),
    // For the month dropdown — the regular monthly batches only, not one-off sends.
    Content.find({ client: clientId, status: { $ne: "draft" }, isIndividual: false }).distinct("batchMonth"),
  ]);

  return ApiResponse(res, 200, "Content fetched successfully", {
    items,
    months,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const getMyContent = asyncHandler(async (req: Request, res: Response) => {
  const clientId = requireClientAccount(req.user!);

  const content = await Content.findOne({ _id: req.params.id, client: clientId, status: { $ne: "draft" } }).populate(
    "createdBy approvedBy comments.user",
    "fullName"
  );
  if (!content) throw new ApiError(404, "Content not found");

  return ApiResponse(res, 200, "Content fetched successfully", content);
});

export const approveMyContent = asyncHandler(async (req: Request, res: Response) => {
  const clientId = requireClientAccount(req.user!);

  const content = await Content.findOne({ _id: req.params.id, client: clientId });
  if (!content) throw new ApiError(404, "Content not found");
  if (content.status === "draft") throw new ApiError(400, "This item hasn't been sent for approval yet");
  if (content.status === "approved") throw new ApiError(400, "This item is already approved");

  content.status = "approved";
  // Stamped here too, not only by the save hook's request context.
  content.approvedAt = new Date();
  content.approvedBy = req.user!._id;
  await content.save();
  await content.populate("createdBy approvedBy comments.user", "fullName");

  return ApiResponse(res, 200, "Content approved", content);
});

// The client's "Request Edit" — always moves the item to revision_requested,
// same as the client-portal's comment box.
export const addMyContentComment = asyncHandler(async (req: Request, res: Response) => {
  const clientId = requireClientAccount(req.user!);
  const requester = req.user!;

  const content = await Content.findOne({ _id: req.params.id, client: clientId });
  if (!content) throw new ApiError(404, "Content not found");
  if (content.status === "draft") throw new ApiError(400, "This item hasn't been sent for approval yet");
  if (content.status === "approved") throw new ApiError(400, "This item is already approved");

  const attachments = await uploadCommentFiles(req);
  content.comments.push({
    author: "client",
    user: requester._id,
    name: requester.fullName,
    text: req.body.text ?? "",
    attachments,
    createdAt: new Date(),
  });
  content.status = "revision_requested";
  await saveWithAttachments(content, attachments);
  await content.populate("createdBy approvedBy comments.user", "fullName");

  return ApiResponse(res, 200, "Comment added", content);
});
