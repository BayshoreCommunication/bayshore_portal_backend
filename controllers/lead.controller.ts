import type { Request, Response } from "express";
import mongoose, { type FilterQuery } from "mongoose";
import {
  Lead,
  LEAD_CHANNELS,
  LEAD_STATUSES,
  type ILead,
  type LeadChannel,
  type LeadStatus,
} from "../models/lead.model";
import { Client } from "../models/client.model";
import type { IUser } from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { canAccessClient, clientScopeFor, visibleClientFilter } from "../utils/clientAccess";
import { normalizePhone } from "../utils/phone";

// What a client must never see: the team's private notes, who on staff did what,
// and how the record got into the system. The single lead also hides who made
// each status change (the list leaves the whole history out, and excluding both
// statusHistory and statusHistory.by in one projection is a path collision).
const CLIENT_HIDDEN = "-internalNotes -createdBy -origin -externalId -__v";
// The lists are rows in a table — the timeline comes with the single lead.
const LIST_EXCLUDES = "-statusHistory";

// What staff may set by hand. channel, statusHistory, convertedAt and createdBy
// are worked out by the model on save.
const EDITABLE_FIELDS = [
  "fullName",
  "phone",
  "email",
  "caseType",
  "source",
  "receivedAt",
  "status",
  "consultationAt",
  "lostReason",
  "notes",
  "internalNotes",
] as const;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// PATCH means "change what I sent". null or "" clears an optional field.
const applyFields = (lead: ILead, body: Record<string, unknown>) => {
  for (const field of EDITABLE_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    lead.set(field, value === null || value === "" ? undefined : value);
  }
};

const pagingOf = (req: Request) => ({
  page: Number(req.query.page) || 1,
  limit: Number(req.query.limit) || 20,
});

// A bare date in `to` ("2026-09-30") means the whole of that day.
const receivedRange = (from?: string, to?: string): FilterQuery<ILead>[] => {
  if (!from && !to) return [];
  const range: Record<string, Date> = {};
  if (from) range.$gte = new Date(from);
  if (to) {
    const end = new Date(to);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      end.setUTCDate(end.getUTCDate() + 1);
      range.$lt = end;
    } else {
      range.$lte = end;
    }
  }
  return [{ receivedAt: range }];
};

// Search matches the lead's name, email, case type or phone (typed with or without formatting).
const searchMatch = (q: string): FilterQuery<ILead> => {
  const search = new RegExp(escapeRegex(q), "i");
  const digits = String(normalizePhone(q));
  return {
    $or: [
      { fullName: search },
      { email: search },
      { caseType: search },
      ...(/^\+?\d{3,}$/.test(digits) ? [{ phone: new RegExp(escapeRegex(digits)) }] : []),
    ],
  };
};

// The list filters besides which client and when, shared by both portals.
const narrowingConditions = (query: Request["query"]) => {
  const { status, channel, caseType, source, q } = query as Record<string, string | undefined>;
  const conditions: FilterQuery<ILead>[] = [];
  if (status) conditions.push({ status });
  if (channel) conditions.push({ channel });
  if (caseType) conditions.push({ caseType });
  if (source) conditions.push({ source });
  if (q) conditions.push(searchMatch(q));
  return conditions;
};

// Counts per status and per channel — the stat tiles and the "Where Leads Come
// From" chart — and the case types in use, for the case type filter and the form's
// suggestions. Taken over the client and date range only, so they stay put while
// the table is narrowed by status, channel or search.
const countsFor = async (match: FilterQuery<ILead>) => {
  const [result] = await Lead.aggregate<{
    statuses: { _id: LeadStatus; count: number }[];
    channels: { _id: LeadChannel; count: number }[];
    caseTypes: { _id: string }[];
  }>([
    { $match: match },
    {
      $facet: {
        statuses: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        channels: [{ $group: { _id: "$channel", count: { $sum: 1 } } }],
        caseTypes: [{ $group: { _id: "$caseType" } }, { $sort: { _id: 1 } }],
      },
    },
  ]);

  const statuses = Object.fromEntries(LEAD_STATUSES.map((value) => [value, 0])) as Record<LeadStatus, number>;
  for (const { _id, count } of result?.statuses ?? []) statuses[_id] = count;
  const channels = Object.fromEntries(LEAD_CHANNELS.map((value) => [value, 0])) as Record<LeadChannel, number>;
  for (const { _id, count } of result?.channels ?? []) if (_id) channels[_id] = count;

  return {
    summary: { total: Object.values(statuses).reduce((sum, count) => sum + count, 0), ...statuses },
    channels,
    caseTypes: (result?.caseTypes ?? []).map(({ _id }) => _id).filter(Boolean),
  };
};

const findVisibleLead = async (requester: IUser, id: string) => {
  const lead = await Lead.findById(id).select("+internalNotes");
  // Same answer whether it doesn't exist or belongs to a client you can't see.
  if (!lead || !(await canAccessClient(requester, lead.client))) {
    throw new ApiError(404, "Lead not found");
  }
  return lead;
};

// ── Staff (company portal) ───────────────────────────────────────────────────

export const createLead = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const { client: clientId } = req.body;

  const client = await Client.exists({ $and: [{ _id: clientId }, clientScopeFor(requester)] });
  if (!client) throw new ApiError(404, "Client not found");

  const lead = new Lead({ client: clientId, origin: "manual" });
  applyFields(lead, req.body);
  await lead.save();

  return ApiResponse(res, 201, "Lead created successfully", lead);
});

export const listLeads = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const { client, from, to } = req.query as Record<string, string | undefined>;
  const { page, limit } = pagingOf(req);

  const scope = await visibleClientFilter(requester);
  // Aggregations don't cast ids the way find() does.
  const period: FilterQuery<ILead>[] = [
    scope,
    ...(client ? [{ client: new mongoose.Types.ObjectId(client) }] : []),
    ...receivedRange(from, to),
  ];
  const filter: FilterQuery<ILead> = { $and: [...period, ...narrowingConditions(req.query)] };

  const [leads, total, counts] = await Promise.all([
    Lead.find(filter)
      .sort({ receivedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(LIST_EXCLUDES)
      .populate("client", "companyName contactName")
      .populate("createdBy", "fullName")
      .lean(),
    Lead.countDocuments(filter),
    countsFor({ $and: period }),
  ]);

  return ApiResponse(res, 200, "Leads fetched successfully", {
    leads,
    ...counts,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const getLead = asyncHandler(async (req: Request, res: Response) => {
  const found = await findVisibleLead(req.user!, req.params.id);
  const lead = await found.populate([
    { path: "client", select: "companyName contactName" },
    { path: "createdBy statusHistory.by", select: "fullName" },
  ]);

  return ApiResponse(res, 200, "Lead fetched successfully", lead);
});

export const updateLead = asyncHandler(async (req: Request, res: Response) => {
  const lead = await findVisibleLead(req.user!, req.params.id);
  applyFields(lead, req.body);
  await lead.save();

  return ApiResponse(res, 200, "Lead updated successfully", lead);
});

export const deleteLead = asyncHandler(async (req: Request, res: Response) => {
  const lead = await findVisibleLead(req.user!, req.params.id);
  await lead.deleteOne();

  return ApiResponse(res, 200, "Lead deleted successfully");
});

// ── The client's own portal: read-only, their own company's leads only ───────

const requireClientAccount = (user: IUser) => {
  if (!user.client) throw new ApiError(403, "This account is not linked to a client");
  return user.client;
};

export const listMyLeads = asyncHandler(async (req: Request, res: Response) => {
  const clientId = requireClientAccount(req.user!);
  const { from, to } = req.query as Record<string, string | undefined>;
  const { page, limit } = pagingOf(req);

  const period: FilterQuery<ILead>[] = [{ client: clientId }, ...receivedRange(from, to)];
  const filter: FilterQuery<ILead> = { $and: [...period, ...narrowingConditions(req.query)] };

  const [leads, total, counts] = await Promise.all([
    Lead.find(filter)
      .sort({ receivedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(`${LIST_EXCLUDES} ${CLIENT_HIDDEN}`)
      .lean(),
    Lead.countDocuments(filter),
    countsFor({ $and: period }),
  ]);

  return ApiResponse(res, 200, "Leads fetched successfully", {
    leads,
    ...counts,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const getMyLead = asyncHandler(async (req: Request, res: Response) => {
  const clientId = requireClientAccount(req.user!);

  const lead = await Lead.findOne({ _id: req.params.id, client: clientId }).select(`${CLIENT_HIDDEN} -statusHistory.by`).lean();
  if (!lead) throw new ApiError(404, "Lead not found");

  return ApiResponse(res, 200, "Lead fetched successfully", lead);
});
