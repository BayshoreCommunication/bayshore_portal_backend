import type { Request, Response } from "express";
import type { FilterQuery } from "mongoose";
import { AuditLog, type IAuditLog } from "../models/auditLog.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { actor, client, resource, resourceId, action, from, to } = req.query as Record<
    string,
    string | undefined
  >;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;

  const filter: FilterQuery<IAuditLog> = {};
  if (actor) filter.actor = actor;
  if (client) filter.client = client;
  if (resource) filter.resource = resource;
  if (resourceId) filter.resourceId = resourceId;
  if (action) filter.action = action;
  if (from || to) {
    filter.createdAt = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    };
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  return ApiResponse(res, 200, "Audit logs fetched successfully", {
    logs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});
