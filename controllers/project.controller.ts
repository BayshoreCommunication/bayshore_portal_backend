import type { Request, Response } from "express";
import mongoose, { type FilterQuery } from "mongoose";
import {
  Project,
  PROJECT_MAX_FILES,
  PROJECT_STATUSES,
  type IProject,
  type IProjectFile,
  type ProjectStatus,
} from "../models/project.model";
import { Client } from "../models/client.model";
import type { IUser } from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { canAccessClient, clientScopeFor, visibleClientFilter } from "../utils/clientAccess";
import { uploadToSpaces, deleteFromSpaces } from "../utils/uploadToSpaces";

// What a client must never see: who on staff opened or handled the project.
const CLIENT_HIDDEN = "-createdBy -__v";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A list sent as repeated form fields, a JSON array, or comma-separated text.
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

// PATCH means "change what I sent". An empty targetDate clears it. The status is
// the team's to set, so it's only read when `withStatus` is on.
const applyFields = (project: IProject, body: Record<string, unknown>, withStatus: boolean) => {
  if (body.name !== undefined) project.name = body.name as string;
  if (body.description !== undefined) project.description = (body.description as string) ?? "";
  if (body.targetDate !== undefined) project.set("targetDate", body.targetDate ? body.targetDate : undefined);
  if (body.priority !== undefined) project.set("priority", body.priority);
  if (withStatus && body.status !== undefined) project.set("status", body.status);
};

const uploadedFilesOf = (req: Request) => ((req.files ?? {}) as Record<string, Express.Multer.File[]>).files ?? [];

const removeFiles = (urls: (string | undefined)[]) => Promise.all(urls.map((url) => deleteFromSpaces(url).catch(() => undefined)));

// All of them go up, or none stay: a failed upload takes the earlier ones back down.
const uploadFiles = async (files: Express.Multer.File[]): Promise<IProjectFile[]> => {
  const uploaded: IProjectFile[] = [];
  try {
    for (const file of files) {
      const url = await uploadToSpaces(file, "projects");
      uploaded.push({ url, name: file.originalname, size: file.size, mimeType: file.mimetype });
    }
  } catch (error) {
    await removeFiles(uploaded.map((file) => file.url));
    throw error;
  }
  return uploaded;
};

// Saves the project with the request's file changes: new uploads under `files`,
// and files to drop by URL in `removeFiles`. Nothing is uploaded until the rest
// of the project is known to be valid, and a file is only deleted from storage
// once the project no longer points at it.
const saveWithFiles = async (project: IProject, req: Request) => {
  const dropped = parseList(req.body.removeFiles);
  // Only what the project actually holds can be removed — never a URL the caller made up.
  const removed = project.files.filter((file) => dropped.includes(file.url)).map((file) => file.url);
  const kept = project.files.filter((file) => !dropped.includes(file.url));
  const incoming = uploadedFilesOf(req);
  if (kept.length + incoming.length > PROJECT_MAX_FILES) {
    throw new ApiError(422, `A project can have at most ${PROJECT_MAX_FILES} files`);
  }

  project.files = kept;
  await project.validate();

  const added = await uploadFiles(incoming);
  project.files = [...kept, ...added];
  try {
    await project.save();
  } catch (error) {
    await removeFiles(added.map((file) => file.url));
    throw error;
  }
  await removeFiles(removed);
};

const pagingOf = (req: Request) => ({
  page: Number(req.query.page) || 1,
  limit: Number(req.query.limit) || 20,
});

// Projects per status — the tiles. Taken over which client only, so they stay put
// while the list is narrowed by status, priority or search.
const summaryFor = async (match: FilterQuery<IProject>) => {
  const rows = await Project.aggregate<{ _id: ProjectStatus; count: number }>([
    { $match: match },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const statuses = Object.fromEntries(PROJECT_STATUSES.map((value) => [value, 0])) as Record<ProjectStatus, number>;
  for (const { _id, count } of rows) statuses[_id] = count;
  return { total: Object.values(statuses).reduce((sum, count) => sum + count, 0), ...statuses };
};

const narrowingConditions = (query: Request["query"]) => {
  const { status, priority } = query as Record<string, string | undefined>;
  const conditions: FilterQuery<IProject>[] = [];
  if (status) conditions.push({ status });
  if (priority) conditions.push({ priority });
  return conditions;
};

const textMatch = (q: string): FilterQuery<IProject>[] => {
  const search = new RegExp(escapeRegex(q), "i");
  return [{ name: search }, { description: search }];
};

const findVisibleProject = async (requester: IUser, id: string) => {
  const project = await Project.findById(id);
  // Same answer whether it doesn't exist or belongs to a client you can't see.
  if (!project || !(await canAccessClient(requester, project.client))) {
    throw new ApiError(404, "Project not found");
  }
  return project;
};

// ── Staff (company portal) ───────────────────────────────────────────────────

export const createProject = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const { client: clientId } = req.body;

  const client = await Client.exists({ $and: [{ _id: clientId }, clientScopeFor(requester)] });
  if (!client) throw new ApiError(404, "Client not found");

  const project = new Project({ client: clientId, requestedBy: "team" });
  applyFields(project, req.body, true);
  await saveWithFiles(project, req);

  return ApiResponse(res, 201, "Project created successfully", project);
});

export const listProjects = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const { client, q } = req.query as Record<string, string | undefined>;
  const { page, limit } = pagingOf(req);

  const scope = await visibleClientFilter(requester);
  // Aggregations don't cast ids the way find() does.
  const base: FilterQuery<IProject>[] = [scope, ...(client ? [{ client: new mongoose.Types.ObjectId(client) }] : [])];

  const conditions = [...base, ...narrowingConditions(req.query)];
  // Search matches the project's name or description, or the client's company name.
  if (q) {
    const clientIds = await Client.find({
      $and: [{ companyName: new RegExp(escapeRegex(q), "i") }, clientScopeFor(requester)],
    }).distinct("_id");
    conditions.push({ $or: [...textMatch(q), { client: { $in: clientIds } }] });
  }
  const filter: FilterQuery<IProject> = { $and: conditions };

  const [projects, total, summary] = await Promise.all([
    Project.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("client", "companyName contactName")
      .populate("createdBy", "fullName")
      .lean(),
    Project.countDocuments(filter),
    summaryFor({ $and: base }),
  ]);

  return ApiResponse(res, 200, "Projects fetched successfully", {
    projects,
    summary,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const getProject = asyncHandler(async (req: Request, res: Response) => {
  const found = await findVisibleProject(req.user!, req.params.id);
  const project = await found.populate([
    { path: "client", select: "companyName contactName" },
    { path: "createdBy", select: "fullName" },
  ]);

  return ApiResponse(res, 200, "Project fetched successfully", project);
});

// Change a project's details or status, add files (`files`), and drop files by URL (`removeFiles`).
export const updateProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await findVisibleProject(req.user!, req.params.id);
  applyFields(project, req.body, true);
  await saveWithFiles(project, req);

  return ApiResponse(res, 200, "Project updated successfully", project);
});

export const deleteProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await findVisibleProject(req.user!, req.params.id);
  await project.deleteOne();
  await removeFiles(project.files.map((file) => file.url));

  return ApiResponse(res, 200, "Project deleted successfully");
});

// ── The client's own portal: their own company's projects only ───────────────

const requireClientAccount = (user: IUser) => {
  if (!user.client) throw new ApiError(403, "This account is not linked to a client");
  return user.client;
};

const findMyProject = async (user: IUser, id: string) => {
  const project = await Project.findOne({ _id: id, client: requireClientAccount(user) });
  if (!project) throw new ApiError(404, "Project not found");
  return project;
};

// What goes back to the client after a change: the saved project without staff details.
const forClient = (project: IProject) => Project.findById(project._id).select(CLIENT_HIDDEN).lean();

export const listMyProjects = asyncHandler(async (req: Request, res: Response) => {
  const clientId = requireClientAccount(req.user!);
  const { q } = req.query as { q?: string };
  const { page, limit } = pagingOf(req);

  const base: FilterQuery<IProject> = { client: clientId };
  const filter: FilterQuery<IProject> = {
    $and: [base, ...narrowingConditions(req.query), ...(q ? [{ $or: textMatch(q) }] : [])],
  };

  const [projects, total, summary] = await Promise.all([
    Project.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(CLIENT_HIDDEN)
      .lean(),
    Project.countDocuments(filter),
    summaryFor(base),
  ]);

  return ApiResponse(res, 200, "Projects fetched successfully", {
    projects,
    summary,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const getMyProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await findMyProject(req.user!, req.params.id);

  return ApiResponse(res, 200, "Project fetched successfully", await forClient(project));
});

export const createMyProject = asyncHandler(async (req: Request, res: Response) => {
  const clientId = requireClientAccount(req.user!);

  const project = new Project({ client: clientId, requestedBy: "client" });
  applyFields(project, req.body, false);
  await saveWithFiles(project, req);

  return ApiResponse(res, 201, "Project created successfully", await forClient(project));
});

// A client can keep refining a project until it's done; the status stays the team's.
export const updateMyProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await findMyProject(req.user!, req.params.id);
  if (project.status === "completed") {
    throw new ApiError(409, "This project is completed and can no longer be changed. Message your account manager if something needs revisiting.");
  }

  applyFields(project, req.body, false);
  await saveWithFiles(project, req);

  return ApiResponse(res, 200, "Project updated successfully", await forClient(project));
});

// Once the team has started on it, withdrawing a project is a conversation, not a button.
export const deleteMyProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await findMyProject(req.user!, req.params.id);
  if (project.status !== "new") {
    throw new ApiError(409, "Work on this project has already started, so it can't be deleted here. Message your account manager to cancel it.");
  }

  await project.deleteOne();
  await removeFiles(project.files.map((file) => file.url));

  return ApiResponse(res, 200, "Project deleted successfully");
});
