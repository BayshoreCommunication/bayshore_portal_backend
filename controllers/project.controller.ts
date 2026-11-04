import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Client, ONBOARDING_TEXT_MAX_LENGTH, type IClient, type IClientProjectFile, type IClientServicePlan } from "../models/client.model";
import { PROJECT_DESCRIPTION_MAX_LENGTH, PROJECT_MAX_FILES, PROJECT_STATUSES, type ProjectStatus } from "../models/project.model";
import { User, type IUser } from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { clientScopeFor } from "../utils/clientAccess";
import { emailProjectCreated } from "../utils/activityEmails";
import { notifyProjectCreated } from "../utils/notifications";
import { uploadToSpaces, deleteFromSpaces } from "../utils/uploadToSpaces";

// A client's projects are their custom services (client.details.services, `custom`): one-time
// work the team named itself, on the client's Services and pricing. There is no project record of
// its own — a project is read from, added to and changed on the client. Its id is the service's
// `project`; what only a project has (stage, priority, files, who asked) is kept on the service.
//   status   "completed" ⇔ the service is done; before that, its stage: "new" or "in_progress"
//   description ⇔ what the service covers, a line each
//   targetDate  ⇔ its deadline
// Adding a project adds a custom service (its price still to set); deleting one takes it off.

type Plan = IClientServicePlan;

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

// ── A service, read as a project ─────────────────────────────────────────────

const statusOf = (plan: Plan): ProjectStatus => (plan.status === "done" ? "completed" : (plan.stage ?? "new"));
const descriptionOf = (plan: Plan) => (plan.included ?? []).join("\n").slice(0, PROJECT_DESCRIPTION_MAX_LENGTH);
const includedOf = (description: string) =>
  description
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((line) => line.slice(0, ONBOARDING_TEXT_MAX_LENGTH));
const dayOf = (date: string) => new Date(date).toISOString().slice(0, 10);
const dateOfDay = (day?: string) => (day && /^\d{4}-\d{2}-\d{2}/.test(day) ? new Date(`${day.slice(0, 10)}T00:00:00.000Z`) : undefined);

type Who = { _id: unknown; fullName: string } | null;

// As the portals have always been sent a project. `staff`: with who on the team opened it.
const viewOf = (client: Pick<IClient, "_id" | "companyName" | "contactName" | "updatedAt">, plan: Plan, staff: false | Map<string, Who>) => ({
  _id: String(plan.project),
  client: staff ? { _id: String(client._id), companyName: client.companyName, contactName: client.contactName } : String(client._id),
  name: plan.name,
  description: descriptionOf(plan),
  targetDate: dateOfDay(plan.deadline),
  priority: plan.priority ?? "normal",
  status: statusOf(plan),
  files: plan.files ?? [],
  requestedBy: plan.requestedBy ?? "team",
  ...(staff ? { createdBy: plan.createdBy ? (staff.get(String(plan.createdBy)) ?? null) : null } : {}),
  startedAt: plan.startedAt ?? (plan.status === "done" ? plan.doneAt : undefined),
  completedAt: plan.status === "done" ? plan.doneAt : undefined,
  // What the team charges for it, once set.
  price: plan.oneTime || plan.monthly || 0,
  createdAt: plan.addedAt ?? client.updatedAt,
  updatedAt: client.updatedAt,
});

const peopleOf = async (plans: Plan[]) => {
  const ids = [...new Set(plans.map((plan) => plan.createdBy).filter(Boolean).map(String))];
  const people = ids.length ? await User.find({ _id: { $in: ids } }).select("fullName").lean() : [];
  return new Map<string, Who>(people.map((person) => [String(person._id), { _id: person._id, fullName: person.fullName }]));
};

// ── Finding them ─────────────────────────────────────────────────────────────

// The clients' custom services, each with its project id. One never given an id before gets it
// now — written on its own, so an older record that wouldn't pass today's checks can't stop the list.
const projectsOf = async (clients: IClient[]) => {
  const found: { client: IClient; plan: Plan }[] = [];
  for (const client of clients) {
    const services = client.details?.services ?? [];
    const ids: Record<string, mongoose.Types.ObjectId> = {};
    services.forEach((plan, index) => {
      if (plan.custom && !plan.project) {
        plan.project = new mongoose.Types.ObjectId();
        ids[`details.services.${index}.project`] = plan.project;
      }
    });
    if (Object.keys(ids).length) await Client.updateOne({ _id: client._id }, { $set: ids });
    for (const plan of services) if (plan.custom) found.push({ client, plan });
  }
  return found;
};

// One project, with the client it is on — among the clients `scope` allows.
const findProject = async (id: string, scope: mongoose.FilterQuery<IClient>) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, "Project not found");
  const client = await Client.findOne({ $and: [{ "details.services": { $elemMatch: { custom: true, project: new mongoose.Types.ObjectId(id) } } }, scope] });
  const plan = client?.details?.services.find((each) => each.custom && String(each.project) === id);
  // Same answer whether it doesn't exist or is on a client you can't see.
  if (!client || !plan) throw new ApiError(404, "Project not found");
  return { client, plan };
};

const pagingOf = (req: Request) => ({
  page: Number(req.query.page) || 1,
  limit: Number(req.query.limit) || 20,
});

// The list: narrowed by status, priority and search, newest first, a page of it — and the
// tiles, counted before the narrowing so they stay put.
const listOf = (found: { client: IClient; plan: Plan }[], req: Request, searchClient: boolean) => {
  const { status, priority, q } = req.query as Record<string, string | undefined>;
  const summary = Object.fromEntries(PROJECT_STATUSES.map((value) => [value, 0])) as Record<ProjectStatus, number>;
  for (const { plan } of found) summary[statusOf(plan)] += 1;
  // Not done and past its deadline.
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = (plan: Plan) => plan.status !== "done" && Boolean(plan.deadline) && String(plan.deadline).slice(0, 10) < today;

  const search = q ? new RegExp(escapeRegex(q), "i") : null;
  const matching = found
    .filter(({ plan }) => !status || (status === "overdue" ? isOverdue(plan) : statusOf(plan) === status))
    .filter(({ plan }) => !priority || (plan.priority ?? "normal") === priority)
    .filter(({ client, plan }) => !search || search.test(plan.name) || search.test(descriptionOf(plan)) || (searchClient && search.test(client.companyName)))
    .sort((a, b) => new Date(b.plan.addedAt ?? 0).getTime() - new Date(a.plan.addedAt ?? 0).getTime());

  const { page, limit } = pagingOf(req);
  return {
    matching,
    page: matching.slice((page - 1) * limit, page * limit),
    summary: { total: found.length, ...summary, overdue: found.filter(({ plan }) => isOverdue(plan)).length },
    pagination: { page, limit, total: matching.length, totalPages: Math.ceil(matching.length / limit) },
  };
};

// ── Changing them ────────────────────────────────────────────────────────────

// PATCH means "change what I sent". An empty targetDate clears it. The status is the team's to
// set, so it's only read when `withStatus` is on.
const applyFields = (plan: Plan, body: Record<string, unknown>, withStatus: boolean) => {
  if (body.name !== undefined) plan.name = String(body.name).trim();
  if (body.description !== undefined) plan.included = includedOf(String(body.description ?? ""));
  if (body.targetDate !== undefined) plan.deadline = body.targetDate ? dayOf(String(body.targetDate)) : undefined;
  if (body.priority !== undefined) plan.priority = body.priority as Plan["priority"];
  if (withStatus && body.status !== undefined) setStatus(plan, body.status as ProjectStatus);
};

// Moving a project along: started and finished as the status says (and back again).
const setStatus = (plan: Plan, status: ProjectStatus) => {
  const now = new Date();
  if (status === "completed") {
    if (plan.status !== "done") plan.doneAt = now;
    plan.status = "done";
    plan.startedAt = plan.startedAt ?? now;
    return;
  }
  plan.status = undefined;
  plan.doneAt = undefined;
  plan.stage = status;
  plan.startedAt = status === "in_progress" ? (plan.startedAt ?? now) : undefined;
};

// Two services can't share a name: the client's services are told apart by it.
const assertNameFree = (client: IClient, name: string, except?: Plan) => {
  const key = name.trim().toLowerCase();
  if ((client.details?.services ?? []).some((plan) => plan !== except && plan.name.trim().toLowerCase() === key)) {
    throw new ApiError(409, `This client already has a service called "${name.trim()}"`);
  }
};

const uploadedFilesOf = (req: Request) => ((req.files ?? {}) as Record<string, Express.Multer.File[]>).files ?? [];
const removeFiles = (urls: (string | undefined)[]) => Promise.all(urls.map((url) => deleteFromSpaces(url).catch(() => undefined)));

// All of them go up, or none stay: a failed upload takes the earlier ones back down.
const uploadFiles = async (files: Express.Multer.File[]): Promise<IClientProjectFile[]> => {
  const uploaded: IClientProjectFile[] = [];
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

// Saves the client with the project's file changes: new uploads under `files`, and files to drop
// by URL in `removeFiles`. Nothing is uploaded until the rest is known to be valid, and a file is
// only deleted from storage once the project no longer points at it.
const saveWithFiles = async (client: IClient, plan: Plan, req: Request) => {
  const dropped = parseList(req.body.removeFiles);
  const current = plan.files ?? [];
  // Only what the project actually holds can be removed — never a URL the caller made up.
  const removed = current.filter((file) => dropped.includes(file.url)).map((file) => file.url);
  const kept = current.filter((file) => !dropped.includes(file.url));
  const incoming = uploadedFilesOf(req);
  if (kept.length + incoming.length > PROJECT_MAX_FILES) throw new ApiError(422, `A project can have at most ${PROJECT_MAX_FILES} files`);

  plan.files = kept;
  client.markModified("details.services");
  await client.validate();

  const added = await uploadFiles(incoming);
  plan.files = [...kept, ...added];
  client.markModified("details.services");
  try {
    await client.save();
  } catch (error) {
    await removeFiles(added.map((file) => file.url));
    throw error;
  }
  await removeFiles(removed);
};

// A new project: a custom service on the client, its price still to set.
const addTo = async (client: IClient, req: Request, requestedBy: "client" | "team", withStatus: boolean) => {
  assertNameFree(client, String(req.body.name ?? ""));
  if (!client.details) client.set("details", {});
  client.set("details.services", [
    ...(client.details?.services ?? []),
    {
      name: String(req.body.name).trim(),
      fields: [],
      monthly: 0,
      oneTime: 0,
      included: [],
      addons: [],
      custom: true,
      project: new mongoose.Types.ObjectId(),
      stage: "new",
      requestedBy,
      createdBy: req.user!._id,
      addedAt: new Date(),
    },
  ]);
  const services = client.details!.services;
  const plan = services[services.length - 1];
  applyFields(plan, req.body, withStatus);
  await saveWithFiles(client, plan, req);
  return plan;
};

// For the emails and notifications that say a project was opened.
const announce = async (client: IClient, plan: Plan, actor: IUser) => {
  const project = { _id: plan.project, client: client._id, name: plan.name, description: descriptionOf(plan), requestedBy: plan.requestedBy ?? "team" };
  await emailProjectCreated(project, actor);
  await notifyProjectCreated(project, actor);
};

const takeOff = async (client: IClient, plan: Plan) => {
  client.set(
    "details.services",
    (client.details?.services ?? []).filter((each) => each !== plan)
  );
  await client.save();
  await removeFiles((plan.files ?? []).map((file) => file.url));
};

// ── Staff (company portal) ───────────────────────────────────────────────────

const staffScope = (requester: IUser, clientId?: string) => ({ $and: [clientScopeFor(requester), ...(clientId ? [{ _id: clientId }] : [])] });

export const createProject = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const client = await Client.findOne(staffScope(requester, String(req.body.client)));
  if (!client) throw new ApiError(404, "Client not found");

  const plan = await addTo(client, req, "team", true);
  await announce(client, plan, requester);

  return ApiResponse(res, 201, "Project created successfully", viewOf(client, plan, await peopleOf([plan])));
});

export const listProjects = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const { client } = req.query as Record<string, string | undefined>;
  const clients = await Client.find({ $and: [staffScope(requester, client), { "details.services.custom": true }] });
  const found = await projectsOf(clients);
  const { matching, page, summary, pagination } = listOf(found, req, true);

  // By client: every one that matches, under its client — with how they stand.
  if (req.query.group === "client") {
    const people = await peopleOf(matching.map(({ plan }) => plan));
    const today = new Date().toISOString().slice(0, 10);
    const groups = new Map<string, { client: IClient; plans: Plan[] }>();
    for (const { client: owner, plan } of matching) {
      const group = groups.get(String(owner._id)) ?? { client: owner, plans: [] };
      group.plans.push(plan);
      groups.set(String(owner._id), group);
    }
    const byClient = [...groups.values()].map(({ client: owner, plans }) => {
      const open = plans.filter((plan) => plan.status !== "done");
      const dues = open.map((plan) => plan.deadline?.slice(0, 10)).filter((day): day is string => Boolean(day)).sort();
      const counts = Object.fromEntries(PROJECT_STATUSES.map((value) => [value, plans.filter((plan) => statusOf(plan) === value).length])) as Record<ProjectStatus, number>;
      return {
        client: { _id: String(owner._id), companyName: owner.companyName, contactName: owner.contactName },
        counts: { total: plans.length, ...counts },
        overdue: dues.filter((day) => day < today).length,
        // The soonest deadline not passed yet.
        nextDue: dues.find((day) => day >= today) ?? null,
        projects: plans.map((plan) => viewOf(owner, plan, people)),
      };
    });
    // Those with work overdue first, then by the soonest deadline, then by name.
    byClient.sort((a, b) => b.overdue - a.overdue || (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999") || a.client.companyName.localeCompare(b.client.companyName));
    return ApiResponse(res, 200, "Projects fetched successfully", { byClient, summary });
  }

  const people = await peopleOf(page.map(({ plan }) => plan));
  return ApiResponse(res, 200, "Projects fetched successfully", {
    projects: page.map(({ client: owner, plan }) => viewOf(owner, plan, people)),
    summary,
    pagination,
  });
});

export const getProject = asyncHandler(async (req: Request, res: Response) => {
  const { client, plan } = await findProject(req.params.id, clientScopeFor(req.user!));
  return ApiResponse(res, 200, "Project fetched successfully", viewOf(client, plan, await peopleOf([plan])));
});

// Change a project's details or status, add files (`files`), and drop files by URL (`removeFiles`).
export const updateProject = asyncHandler(async (req: Request, res: Response) => {
  const { client, plan } = await findProject(req.params.id, clientScopeFor(req.user!));
  if (req.body.name !== undefined) assertNameFree(client, String(req.body.name), plan);
  applyFields(plan, req.body, true);
  await saveWithFiles(client, plan, req);
  return ApiResponse(res, 200, "Project updated successfully", viewOf(client, plan, await peopleOf([plan])));
});

export const deleteProject = asyncHandler(async (req: Request, res: Response) => {
  const { client, plan } = await findProject(req.params.id, clientScopeFor(req.user!));
  await takeOff(client, plan);
  return ApiResponse(res, 200, "Project deleted successfully");
});

// ── The client's own portal: their own company's projects only ───────────────

const myClientOf = async (user: IUser) => {
  if (!user.client) throw new ApiError(403, "This account is not linked to a client");
  const client = await Client.findById(user.client);
  if (!client) throw new ApiError(403, "This account is not linked to a client");
  return client;
};

const findMyProject = (user: IUser, id: string) => {
  if (!user.client) throw new ApiError(403, "This account is not linked to a client");
  return findProject(id, { _id: user.client });
};

export const listMyProjects = asyncHandler(async (req: Request, res: Response) => {
  const client = await myClientOf(req.user!);
  const found = await projectsOf([client]);
  const { page, summary, pagination } = listOf(found, req, false);

  return ApiResponse(res, 200, "Projects fetched successfully", {
    projects: page.map(({ plan }) => viewOf(client, plan, false)),
    summary,
    pagination,
  });
});

export const getMyProject = asyncHandler(async (req: Request, res: Response) => {
  const { client, plan } = await findMyProject(req.user!, req.params.id);
  return ApiResponse(res, 200, "Project fetched successfully", viewOf(client, plan, false));
});

export const createMyProject = asyncHandler(async (req: Request, res: Response) => {
  const client = await myClientOf(req.user!);
  const plan = await addTo(client, req, "client", false);
  await announce(client, plan, req.user!);
  return ApiResponse(res, 201, "Project created successfully", viewOf(client, plan, false));
});

// A client can keep refining a project until it's done; the status stays the team's.
export const updateMyProject = asyncHandler(async (req: Request, res: Response) => {
  const { client, plan } = await findMyProject(req.user!, req.params.id);
  if (statusOf(plan) === "completed") {
    throw new ApiError(409, "This project is completed and can no longer be changed. Message your account manager if something needs revisiting.");
  }
  if (req.body.name !== undefined) assertNameFree(client, String(req.body.name), plan);
  applyFields(plan, req.body, false);
  await saveWithFiles(client, plan, req);
  return ApiResponse(res, 200, "Project updated successfully", viewOf(client, plan, false));
});

// Once the team has started on it, withdrawing a project is a conversation, not a button.
export const deleteMyProject = asyncHandler(async (req: Request, res: Response) => {
  const { client, plan } = await findMyProject(req.user!, req.params.id);
  if (statusOf(plan) !== "new") {
    throw new ApiError(409, "Work on this project has already started, so it can't be deleted here. Message your account manager to cancel it.");
  }
  await takeOff(client, plan);
  return ApiResponse(res, 200, "Project deleted successfully");
});
