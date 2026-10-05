import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Service, type IService } from "../models/service.model";
import { ClientService } from "../models/clientService.model";
import type { IUser } from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { canAccessClient, visibleClientFilter } from "../utils/clientAccess";
import { planFromCatalog } from "../utils/clientServices";

type SubServiceInput = { _id?: string; name: string; price: number };

const duplicateAware = async (save: () => Promise<unknown>) => {
  try {
    await save();
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new ApiError(409, "The catalog already has a service with that name");
    }
    throw error;
  }
};

const findService = async (id: string) => {
  const service = await Service.findById(id);
  if (!service) throw new ApiError(404, "Service not found");
  return service;
};

// After a catalog service changes, brings along every client who takes it: a
// renamed or re-priced sub-service is updated on their copy (so their monthly
// payment follows the catalog), a removed one is dropped, and a client left with
// none of its sub-services no longer has the service. Sub-services added to the
// catalog are not given to anyone automatically.
const syncClientServices = async (service: IService) => {
  const current = new Map(service.subServices.map((item) => [String(item._id), item]));
  const assignments = await ClientService.find({ service: service._id });
  let updated = 0;
  let removed = 0;

  for (const assignment of assignments) {
    const kept = assignment.subServices.flatMap((item) => {
      const match = current.get(String(item.subService));
      return match ? [{ subService: match._id, name: match.name, price: match.price }] : [];
    });

    if (kept.length === 0) {
      await assignment.deleteOne();
      removed += 1;
      continue;
    }

    const changed =
      kept.length !== assignment.subServices.length ||
      kept.some((item, index) => item.name !== assignment.subServices[index].name || item.price !== assignment.subServices[index].price);
    if (changed) {
      assignment.subServices = kept;
      await assignment.save();
      updated += 1;
    }
  }

  return { updated, removed };
};

// ── The catalog (company portal) ─────────────────────────────────────────────

// Every catalog service, with how many of the caller's clients take each one and
// what those clients pay for it — the catalog table, its tiles and the
// "who takes what" chart.
export const listServices = asyncHandler(async (req: Request, res: Response) => {
  const scope = await visibleClientFilter(req.user!);

  const [services, usage, clients] = await Promise.all([
    Service.find().sort({ createdAt: 1, _id: 1 }).lean(),
    ClientService.aggregate<{ _id: mongoose.Types.ObjectId; clients: number; monthly: number }>([
      { $match: scope },
      { $group: { _id: "$service", clients: { $sum: 1 }, monthly: { $sum: "$monthlyPrice" } } },
    ]),
    ClientService.distinct("client", scope),
  ]);

  const usageOf = new Map(usage.map((row) => [String(row._id), row]));

  return ApiResponse(res, 200, "Services fetched successfully", {
    services: services.map((service) => ({
      ...service,
      clientCount: usageOf.get(String(service._id))?.clients ?? 0,
      monthlyRevenue: usageOf.get(String(service._id))?.monthly ?? 0,
    })),
    summary: {
      services: services.length,
      subServices: services.reduce((sum, service) => sum + service.subServices.length, 0),
      clientsServed: clients.length,
      // What all the caller's clients pay a month, together.
      monthlyTotal: usage.reduce((sum, row) => sum + row.monthly, 0),
    },
  });
});

export const getService = asyncHandler(async (req: Request, res: Response) => {
  const service = await findService(req.params.id);
  return ApiResponse(res, 200, "Service fetched successfully", service);
});

export const createService = asyncHandler(async (req: Request, res: Response) => {
  const { title, description, plan, color, subServices } = req.body as {
    title: string;
    description?: string;
    plan?: string;
    color?: string;
    subServices: SubServiceInput[];
  };

  const service = new Service({
    title,
    description,
    plan,
    color: color || undefined,
    // Ids are the catalog's to hand out; one sent with a new service is ignored.
    subServices: subServices.map(({ name, price }) => ({ name, price })),
  });
  await duplicateAware(() => service.save());

  return ApiResponse(res, 201, "Service created successfully", service);
});

// Send only what changes. `subServices`, when sent, is the whole new list: one with
// its `_id` is the same sub-service renamed or re-priced, one without is new, and
// one left out is removed. Clients who take the service are brought along.
export const updateService = asyncHandler(async (req: Request, res: Response) => {
  const service = await findService(req.params.id);
  const { title, description, plan, color, subServices } = req.body as {
    title?: string;
    description?: string;
    plan?: string;
    color?: string;
    subServices?: SubServiceInput[];
  };

  if (title !== undefined) service.title = title;
  if (description !== undefined) service.description = description;
  if (plan !== undefined) service.set("plan", plan);
  if (color !== undefined) service.set("color", color || undefined);

  if (subServices !== undefined) {
    const existing = new Set(service.subServices.map((item) => String(item._id)));
    const unknown = subServices.find((item) => item._id && !existing.has(item._id));
    if (unknown) throw new ApiError(422, `"${unknown.name}" isn't a sub-service of this service — leave its id out to add it as new`);

    service.set(
      "subServices",
      subServices.map(({ _id, name, price }) => ({ ...(_id ? { _id } : {}), name, price }))
    );
  }

  await duplicateAware(() => service.save());
  const clients = await syncClientServices(service);

  return ApiResponse(res, 200, "Service updated successfully", { service, clients });
});

// A service clients are paying for can't just vanish from their accounts.
export const deleteService = asyncHandler(async (req: Request, res: Response) => {
  const service = await findService(req.params.id);

  const inUse = await ClientService.countDocuments({ service: service._id });
  if (inUse > 0) {
    throw new ApiError(
      409,
      `${inUse} ${inUse === 1 ? "client takes" : "clients take"} this service. Remove it from ${inUse === 1 ? "that client" : "those clients"} first.`
    );
  }

  await service.deleteOne();
  return ApiResponse(res, 200, "Service deleted successfully");
});

// ── A client's services and monthly payment ──────────────────────────────────

// The services a client takes and what they add up to a month. Staff also get
// each catalog service in full (to show "4 of 6 sub-services" and what's left
// out); the client gets only what they take, without who assigned it.
const clientServicesOf = async (clientId: unknown, forClient: boolean) => {
  const query = ClientService.find({ client: clientId })
    .sort({ createdAt: 1, _id: 1 })
    .select(forClient ? "-assignedBy -__v" : "-__v")
    .populate("service", forClient ? "title description plan color" : "title description plan color subServices monthlyPrice");
  if (!forClient) query.populate("assignedBy", "fullName");
  const services = await query.lean();

  return {
    services,
    // The client's monthly payment.
    monthlyTotal: services.reduce((sum, entry) => sum + entry.monthlyPrice, 0),
  };
};

const requireVisibleClient = async (requester: IUser, clientId: string) => {
  // Same answer whether it doesn't exist or isn't one of the caller's clients.
  if (!(await canAccessClient(requester, clientId))) throw new ApiError(404, "Client not found");
};

export const getClientServices = asyncHandler(async (req: Request, res: Response) => {
  await requireVisibleClient(req.user!, req.params.clientId);
  return ApiResponse(res, 200, "Client services fetched successfully", await clientServicesOf(req.params.clientId, false));
});

// Replaces the whole set of services a client takes — what the "Assign Services"
// window saves. Everything is checked against the catalog before anything is
// written, so a bad entry can't leave the client half-updated.
export const setClientServices = asyncHandler(async (req: Request, res: Response) => {
  const { clientId } = req.params;
  await requireVisibleClient(req.user!, clientId);

  const planned = await planFromCatalog(req.body.services);
  const kept = new Set(planned.map(({ service }) => String(service._id)));

  const existing = await ClientService.find({ client: clientId });

  for (const { service, subServices } of planned) {
    const assignment = existing.find((entry) => String(entry.service) === String(service._id)) ?? new ClientService({ client: clientId, service: service._id });
    assignment.subServices = subServices;
    if (assignment.isNew || assignment.isModified()) await assignment.save();
  }
  for (const assignment of existing) {
    if (!kept.has(String(assignment.service))) await assignment.deleteOne();
  }

  return ApiResponse(res, 200, "Client services saved successfully", await clientServicesOf(clientId, false));
});

// ── The client's own portal: what they take and what they pay ────────────────
// Adding more is paid for first — see controllers/payment.controller.ts.

export const listMyServices = asyncHandler(async (req: Request, res: Response) => {
  const clientId = req.user!.client;
  if (!clientId) throw new ApiError(403, "This account is not linked to a client");

  return ApiResponse(res, 200, "Services fetched successfully", await clientServicesOf(clientId, true));
});

// The whole catalog, for a client to browse — without how many other clients take
// each service or what they pay.
export const listCatalogForClient = asyncHandler(async (_req: Request, res: Response) => {
  const services = await Service.find().sort({ createdAt: 1, _id: 1 }).select("title description plan color subServices monthlyPrice").lean();
  return ApiResponse(res, 200, "Services fetched successfully", { services });
});
