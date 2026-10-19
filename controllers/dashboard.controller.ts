import type { Request, Response } from "express";
import mongoose, { type FilterQuery, type PipelineStage } from "mongoose";
import { Client } from "../models/client.model";
import { Lead } from "../models/lead.model";
import { ServiceOrder } from "../models/serviceOrder.model";
import { Report } from "../models/report.model";
import { Content } from "../models/content.model";
import { Project } from "../models/project.model";
import { Message } from "../models/message.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { clientScopeFor, visibleClientFilter } from "../utils/clientAccess";

// ── The staff dashboard ──────────────────────────────────────────────────────

// Everything company-portal's dashboard shows, in one call, over the clients the caller can
// see. Months are calendar months in UTC; "this month" runs from its 1st up to now, and is
// compared with the same stretch of last month (1st up to the same day and time), so a month
// half gone isn't set against a whole one.

// Money still owed: an order waiting on Stripe, or one whose payment was declined.
const UNPAID_STATUSES = ["pending", "failed"];

// How many months the charts run over, this one included.
const MONTHS = 12;
// How many clients the unpaid card names before folding the rest into one line.
const UNPAID_ROWS = 4;
// How many items each list in the right column shows.
const LIST_LIMIT = 5;
const MEETING_LIMIT = 4;

const DAY = 24 * 60 * 60 * 1000;

const monthStart = (date: Date, offset = 0) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
// "2026-10"
const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

// The same moment last month — or the end of last month, when it is shorter.
const sameTimeLastMonth = (now: Date) => {
  const start = monthStart(now, -1);
  const end = monthStart(now);
  return new Date(Math.min(start.getTime() + (now.getTime() - monthStart(now).getTime()), end.getTime()));
};

// Per month, oldest first: the figure grouped under each "YYYY-MM" key, 0 for a month with none.
const byMonth = (keys: string[], rows: { _id: string; value: number }[]) => {
  const found = new Map(rows.map((row) => [row._id, row.value]));
  return keys.map((key) => found.get(key) ?? 0);
};

const monthGroup = (field: string, value: unknown): PipelineStage => ({
  $group: { _id: { $dateToString: { format: "%Y-%m", date: `$${field}`, timezone: "UTC" } }, value: { $sum: value } },
});

const sum = async (match: FilterQuery<unknown>, field: string) =>
  (await ServiceOrder.aggregate<{ value: number }>([{ $match: match }, { $group: { _id: null, value: { $sum: `$${field}` } } }]))[0]?.value ?? 0;

// GET /dashboard/overview
export const getOverview = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const now = new Date();
  const thisMonth = monthStart(now);
  const lastMonth = monthStart(now, -1);
  const lastMonthSoFar = sameTimeLastMonth(now);
  const firstMonth = monthStart(now, -(MONTHS - 1));
  const keys = Array.from({ length: MONTHS }, (_, index) => monthKey(monthStart(now, index - (MONTHS - 1))));

  const clientScope = clientScopeFor(requester);
  // A filter on another collection's `client` field. Aggregations don't cast ids, so the
  // ids are kept as ObjectIds.
  const scope = (await visibleClientFilter(requester)) as FilterQuery<unknown>;
  const and = (...conditions: FilterQuery<unknown>[]) => ({ $and: [scope, ...conditions] });

  // What was still owed at a moment: ordered by then, and either still unpaid or paid since.
  const owedAt = (moment: Date) =>
    and({ createdAt: { $lte: moment } }, { $or: [{ status: { $in: UNPAID_STATUSES } }, { status: "paid", paidAt: { $gt: moment } }] });

  const [
    activeClients,
    activeBefore,
    leadsNow,
    leadsBefore,
    collectedNow,
    collectedBefore,
    unpaidNow,
    unpaidBefore,
    collectedByMonth,
    unpaidByMonth,
    clientsByMonth,
    onboarding,
    closed,
    unpaidByClient,
  ] = await Promise.all([
    Client.countDocuments({ $and: [clientScope, { status: "active" }] }),
    // There is no history of a client's status, so last month's count is the active clients
    // that were already with us then.
    Client.countDocuments({ $and: [clientScope, { status: "active", createdAt: { $lt: thisMonth } }] }),
    Lead.countDocuments(and({ receivedAt: { $gte: thisMonth, $lte: now } })),
    Lead.countDocuments(and({ receivedAt: { $gte: lastMonth, $lte: lastMonthSoFar } })),
    sum(and({ status: "paid", paidAt: { $gte: thisMonth, $lte: now } }), "amount"),
    sum(and({ status: "paid", paidAt: { $gte: lastMonth, $lte: lastMonthSoFar } }), "amount"),
    sum(owedAt(now), "amount"),
    sum(owedAt(lastMonthSoFar), "amount"),
    ServiceOrder.aggregate<{ _id: string; value: number }>([
      { $match: and({ status: "paid", paidAt: { $gte: firstMonth } }) },
      monthGroup("paidAt", "$amount"),
    ]),
    ServiceOrder.aggregate<{ _id: string; value: number }>([
      { $match: and({ status: { $in: UNPAID_STATUSES }, createdAt: { $gte: firstMonth } }) },
      monthGroup("createdAt", "$amount"),
    ]),
    Client.aggregate<{ _id: string; value: number }>([
      { $match: { $and: [clientScope, { createdAt: { $gte: firstMonth } }] } },
      monthGroup("createdAt", 1),
    ]),
    Client.countDocuments({ $and: [clientScope, { status: "onboarding" }] }),
    Client.countDocuments({ $and: [clientScope, { status: "closed" }] }),
    ServiceOrder.aggregate<{ _id: mongoose.Types.ObjectId; amount: number; orders: number; oldest: Date; declined: number }>([
      { $match: and({ status: { $in: UNPAID_STATUSES } }) },
      {
        $group: {
          _id: "$client",
          amount: { $sum: "$amount" },
          orders: { $sum: 1 },
          oldest: { $min: "$createdAt" },
          declined: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, "$amount", 0] } },
        },
      },
      { $sort: { amount: -1 } },
    ]),
  ]);

  const names = new Map(
    (await Client.find({ _id: { $in: unpaidByClient.slice(0, UNPAID_ROWS).map((row) => row._id) } }).select("companyName").lean()).map((entry) => [
      String(entry._id),
      entry.companyName,
    ]),
  );
  const rest = unpaidByClient.slice(UNPAID_ROWS);

  // Work waiting on the team: reports handed in for review, content the client sent back,
  // and projects nobody has started — newest first, mixed together.
  const [reports, contents, projects, reportCount, contentCount, projectCount, meetings, meetingCount] = await Promise.all([
    Report.find(and({ status: "submitted" })).sort({ updatedAt: -1 }).limit(LIST_LIMIT).select("title periodType periodStart client updatedAt").populate("client", "companyName").lean(),
    Content.find(and({ status: "revision_requested" })).sort({ updatedAt: -1 }).limit(LIST_LIMIT).select("title type client updatedAt").populate("client", "companyName").lean(),
    Project.find(and({ status: "new" })).sort({ createdAt: -1 }).limit(LIST_LIMIT).select("name client createdAt").populate("client", "companyName").lean(),
    Report.countDocuments(and({ status: "submitted" })),
    Content.countDocuments(and({ status: "revision_requested" })),
    Project.countDocuments(and({ status: "new" })),
    Message.find(and({ kind: "meeting", "meeting.startsAt": { $gte: now } })).sort({ "meeting.startsAt": 1 }).limit(MEETING_LIMIT).select("meeting client").populate("client", "companyName").lean(),
    Message.countDocuments(and({ kind: "meeting", "meeting.startsAt": { $gte: now } })),
  ]);

  const companyOf = (client: unknown) => (client && typeof client === "object" && "companyName" in client ? String(client.companyName) : "");

  const reviews = [
    ...reports.map((report) => ({
      kind: "report" as const,
      id: String(report._id),
      title: report.title || `${report.periodType === "weekly" ? "Weekly" : "Monthly"} Report`,
      client: companyOf(report.client),
      status: "review" as const,
      at: report.updatedAt,
    })),
    ...contents.map((content) => ({
      kind: ["video", "story"].includes(content.type) ? ("reel" as const) : ("content" as const),
      id: String(content._id),
      title: content.title,
      client: companyOf(content.client),
      status: "revision" as const,
      at: content.updatedAt,
    })),
    ...projects.map((project) => ({
      kind: "project" as const,
      id: String(project._id),
      title: project.name,
      client: companyOf(project.client),
      status: "request" as const,
      at: project.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, LIST_LIMIT);

  const clientsNow = clientsByMonth.find((row) => row._id === keys[MONTHS - 1])?.value ?? 0;
  const clientsBefore = await Client.countDocuments({ $and: [clientScope, { createdAt: { $gte: lastMonth, $lte: lastMonthSoFar } }] });

  return ApiResponse(res, 200, "Dashboard fetched successfully", {
    // The months the charts cover, oldest first; the last is this month.
    months: keys,
    // Each headline figure now, and at the same point last month.
    cards: {
      activeClients: { value: activeClients, previous: activeBefore },
      leads: { value: leadsNow, previous: leadsBefore },
      collected: { value: collectedNow, previous: collectedBefore },
      unpaid: { value: unpaidNow, previous: unpaidBefore },
    },
    // Whole dollars. Collected by the month it was paid; unpaid by the month it was ordered.
    revenue: {
      collected: byMonth(keys, collectedByMonth),
      unpaid: byMonth(keys, unpaidByMonth),
    },
    newClients: {
      byMonth: byMonth(keys, clientsByMonth),
      thisMonth: { value: clientsNow, previous: clientsBefore },
      active: activeClients,
      onboarding,
      closed,
    },
    unpaid: {
      clients: unpaidByClient.slice(0, UNPAID_ROWS).map((row) => ({
        client: String(row._id),
        companyName: names.get(String(row._id)) ?? "Deleted client",
        amount: row.amount,
        // How long the oldest of its orders has been waiting, and how much of it was declined.
        waitingDays: Math.floor((now.getTime() - new Date(row.oldest).getTime()) / DAY),
        declined: row.declined,
      })),
      // The clients after those, folded into one line.
      others: rest.length ? { count: rest.length, amount: rest.reduce((total, row) => total + row.amount, 0) } : null,
      total: unpaidByClient.reduce((total, row) => total + row.amount, 0),
      declined: unpaidByClient.reduce((total, row) => total + row.declined, 0),
      orders: unpaidByClient.reduce((total, row) => total + row.orders, 0),
      clientCount: unpaidByClient.length,
    },
    reviews: {
      items: reviews.map(({ at: _at, ...item }) => item),
      total: reportCount + contentCount + projectCount,
      counts: { reports: reportCount, content: contentCount, projects: projectCount },
    },
    meetings: {
      items: meetings.map((message) => ({
        id: String(message._id),
        title: message.meeting?.title ?? "Meeting",
        startsAt: message.meeting?.startsAt,
        location: message.meeting?.location,
        client: companyOf(message.client),
      })),
      total: meetingCount,
    },
  });
});
