import type { Request, Response } from "express";
import type { FilterQuery } from "mongoose";
import {
  Report,
  REPORT_STATUSES,
  defaultReportTitle,
  type IReport,
  type ReportStatus,
} from "../models/report.model";
import { Client } from "../models/client.model";
import type { IUser } from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { canAccessClient, clientScopeFor, visibleClientFilter } from "../utils/clientAccess";
import { REPORT_REVIEW_ROLES } from "../utils/reportAccess";

const isReviewer = (user: IUser) => REPORT_REVIEW_ROLES.includes(user.role);

// The lists show a report's headline only; the full sections come with the single report.
const LIST_EXCLUDES = "-summary -social -blogs -website -gmb";
// What a client must never see: who on staff did what, and when it was reviewed.
const CLIENT_HIDDEN = "-createdBy -submittedAt -approvedBy -approvedAt -publishedBy -__v";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STATUS_ORDER: Record<ReportStatus, number> = { draft: 0, submitted: 1, approved: 2, published: 3 };

type Plain = Record<string, unknown>;
const isPlainObject = (value: unknown): value is Plain =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// [["social.reel.views", 100], ...] — objects are walked, arrays and values are leaves.
const leaves = (value: unknown, prefix = ""): [string, unknown][] =>
  isPlainObject(value)
    ? Object.entries(value).flatMap(([key, inner]) => leaves(inner, prefix ? `${prefix}.${key}` : key))
    : [[prefix, value]];

const hasValue = (value: unknown) =>
  value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);

const hasContent = (report: IReport) => {
  const data = report.toObject();
  return (
    hasValue(data.summary) ||
    hasValue(data.blogs) ||
    ["social", "website", "gmb"].some((name) => leaves(data[name], name).some(([, value]) => hasValue(value)))
  );
};

// PATCH means "change what I sent". Sections are merged figure by figure, so sending
// only social.facebookReach leaves the other figures alone; lists are replaced whole;
// null clears a figure.
const applyContent = (report: IReport, body: Plain) => {
  if (body.title !== undefined) report.title = (body.title as string) || (undefined as unknown as string);
  if (body.summary !== undefined) report.summary = body.summary as string;
  if (body.blogs !== undefined) report.set("blogs", body.blogs);

  for (const name of ["social", "website", "gmb"]) {
    for (const [path, value] of leaves(body[name], name)) {
      if (path !== name) report.set(path, value === null ? undefined : value);
    }
  }
};

const duplicateAware = async (save: () => Promise<unknown>) => {
  try {
    await save();
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new ApiError(409, "A report for this client and period already exists");
    }
    throw error;
  }
};

const findVisibleReport = async (requester: IUser, id: string) => {
  const report = await Report.findById(id);
  // Same answer whether it doesn't exist or belongs to a client you can't see.
  if (!report || !(await canAccessClient(requester, report.client))) {
    throw new ApiError(404, "Report not found");
  }
  return report;
};

// The last published report before this one — the figures the ▲/▼ percentages compare against.
const previousPublished = (report: Pick<IReport, "client" | "periodType" | "periodStart">) =>
  Report.findOne({
    client: report.client,
    periodType: report.periodType,
    status: "published",
    periodStart: { $lt: report.periodStart },
  })
    .sort({ periodStart: -1 })
    .select("title periodStart periodEnd social website gmb -_id")
    .lean();

const pagingOf = (req: Request) => ({
  page: Number(req.query.page) || 1,
  limit: Number(req.query.limit) || 20,
});

const periodConditions = (query: Request["query"]) => {
  const { periodType, from, to } = query as Record<string, string | undefined>;
  const conditions: FilterQuery<IReport>[] = [];
  if (periodType) conditions.push({ periodType });
  if (from || to) {
    conditions.push({
      periodStart: { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) },
    });
  }
  return conditions;
};

const titleMatch = (q: string) => ({ title: new RegExp(escapeRegex(q), "i") });

// ── Staff ──────────────────────────────────────────────────────────────────

export const createReport = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const { client: clientId, periodType, periodStart, periodEnd } = req.body;

  const client = await Client.exists({ $and: [{ _id: clientId }, clientScopeFor(requester)] });
  if (!client) throw new ApiError(404, "Client not found");

  const report = new Report({ client: clientId, periodType, periodStart, periodEnd });
  applyContent(report, req.body);
  await duplicateAware(() => report.save());

  return ApiResponse(res, 201, "Report created successfully", report);
});

export const listReports = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const { client, status } = req.query as Record<string, string | undefined>;
  const { page, limit } = pagingOf(req);

  const scope = await visibleClientFilter(requester);

  const conditions: FilterQuery<IReport>[] = [scope, ...periodConditions(req.query)];
  if (client) conditions.push({ client });
  if (status) conditions.push({ status });

  // Search matches the report's title or the client's company name.
  const { q } = req.query as { q?: string };
  if (q) {
    const clientIds = await Client.find({
      $and: [{ companyName: new RegExp(escapeRegex(q), "i") }, clientScopeFor(requester)],
    }).distinct("_id");
    conditions.push({ $or: [titleMatch(q), { client: { $in: clientIds } }] });
  }
  const filter: FilterQuery<IReport> = { $and: conditions };

  const [reports, total, statusCounts] = await Promise.all([
    Report.find(filter)
      .sort({ periodStart: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(LIST_EXCLUDES)
      .populate("client", "companyName contactName")
      .lean(),
    Report.countDocuments(filter),
    // Across everything this person can see, ignoring the filters — for tabs and badges.
    Report.aggregate<{ _id: ReportStatus; count: number }>([
      { $match: scope },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const summary = Object.fromEntries(REPORT_STATUSES.map((value) => [value, 0])) as Record<ReportStatus, number>;
  for (const { _id, count } of statusCounts) summary[_id] = count;

  return ApiResponse(res, 200, "Reports fetched successfully", {
    reports,
    summary: { total: Object.values(summary).reduce((sum, count) => sum + count, 0), ...summary },
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const getReport = asyncHandler(async (req: Request, res: Response) => {
  const found = await findVisibleReport(req.user!, req.params.id);
  const report = await found.populate([
    { path: "client", select: "companyName contactName" },
    { path: "createdBy approvedBy publishedBy", select: "fullName" },
  ]);

  return ApiResponse(res, 200, "Report fetched successfully", {
    report,
    previous: await previousPublished(found),
  });
});

export const updateReport = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const report = await findVisibleReport(requester, req.params.id);

  if (report.status !== "draft" && !isReviewer(requester)) {
    throw new ApiError(403, "Only a draft can be edited. Ask a manager to send this report back to draft.");
  }

  const { periodType, periodStart, periodEnd } = req.body;
  const hadDefaultTitle = report.title === defaultReportTitle(report.periodType, report.periodStart);

  if (periodType !== undefined) report.periodType = periodType;
  if (periodStart !== undefined) report.periodStart = periodStart;
  if (periodEnd !== undefined) report.periodEnd = periodEnd;
  applyContent(report, req.body);

  // A title that was never customised follows the period.
  const periodChanged = report.isModified("periodType") || report.isModified("periodStart");
  if (periodChanged && hadDefaultTitle && req.body.title === undefined) {
    report.title = undefined as unknown as string;
  }

  await duplicateAware(() => report.save());

  return ApiResponse(res, 200, "Report updated successfully", report);
});

export const changeReportStatus = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const target: ReportStatus = req.body.status;
  const report = await findVisibleReport(requester, req.params.id);
  const current = report.status;

  if (target === current) throw new ApiError(400, `This report is already ${current}`);

  if (isReviewer(requester)) {
    // Reviewers can move a report forward (skipping steps is fine) or send it back to draft.
    if (target !== "draft" && STATUS_ORDER[target] < STATUS_ORDER[current]) {
      throw new ApiError(400, `A ${current} report can only be sent back to draft`);
    }
  } else if (!(current === "draft" && target === "submitted")) {
    throw new ApiError(403, "You can hand a draft in for review; approving and publishing is for managers");
  }

  if (target !== "draft" && !hasContent(report)) {
    throw new ApiError(422, "Add a summary or some figures before moving this report forward");
  }

  report.status = target;
  await report.save();

  return ApiResponse(res, 200, `Report is now ${target}`, report);
});

export const deleteReport = asyncHandler(async (req: Request, res: Response) => {
  const report = await findVisibleReport(req.user!, req.params.id);
  await report.deleteOne();

  return ApiResponse(res, 200, "Report deleted successfully");
});

// ── The client's own portal: published reports of their own company only ────

const requireClientAccount = (user: IUser) => {
  if (!user.client) throw new ApiError(403, "This account is not linked to a client");
  return user.client;
};

export const listMyReports = asyncHandler(async (req: Request, res: Response) => {
  const clientId = requireClientAccount(req.user!);
  const { page, limit } = pagingOf(req);

  const { q, full } = req.query as { q?: string; full?: string };
  const filter: FilterQuery<IReport> = {
    $and: [
      { client: clientId, status: "published" },
      ...periodConditions(req.query),
      ...(q ? [titleMatch(q)] : []),
    ],
  };

  const [reports, total] = await Promise.all([
    Report.find(filter)
      .sort({ periodStart: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      // `full=true` keeps the figures (for the dashboard's trends); otherwise headlines only.
      .select(full === "true" ? CLIENT_HIDDEN : `${LIST_EXCLUDES} ${CLIENT_HIDDEN}`)
      .lean(),
    Report.countDocuments(filter),
  ]);

  return ApiResponse(res, 200, "Reports fetched successfully", {
    reports,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const getMyReport = asyncHandler(async (req: Request, res: Response) => {
  const clientId = requireClientAccount(req.user!);

  const report = await Report.findOne({ _id: req.params.id, client: clientId, status: "published" })
    .select(CLIENT_HIDDEN)
    .lean();
  if (!report) throw new ApiError(404, "Report not found");

  return ApiResponse(res, 200, "Report fetched successfully", {
    report,
    previous: await previousPublished(report),
  });
});
