import mongoose, { Schema, Document } from "mongoose";
import { auditPlugin } from "../plugins/auditPlugin";
import { getRequestContext } from "../utils/requestContext";

export const REPORT_PERIOD_TYPES = ["weekly", "monthly"] as const;
export type ReportPeriodType = (typeof REPORT_PERIOD_TYPES)[number];

// draft → submitted (ready for review) → approved → published (visible to the client).
// A reviewer can send it back to draft, which clears the later steps.
export const REPORT_STATUSES = ["draft", "submitted", "approved", "published"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_SUMMARY_MAX_LENGTH = 5000;

export interface IReport extends Document {
  client: mongoose.Types.ObjectId;
  title: string;
  periodType: ReportPeriodType;
  periodStart: Date;
  periodEnd: Date;
  status: ReportStatus;
  summary?: string;
  social?: {
    facebookReach?: number;
    instagramReach?: number;
    twitterReach?: number;
    linkedinReach?: number;
    // The period's videos, each with its own figures.
    videos: { title: string; views?: number; impressions?: number }[];
    // An older report's single best-performing video — `videos` took its place.
    reel?: { title?: string; views?: number };
  };
  blogs: { title: string; publishedAt?: Date; graphicsCount?: number; url?: string }[];
  website?: {
    impressions?: number;
    clicks?: number;
    backlinks?: number;
    referringDomains?: number;
    leadsForwarded?: number;
  };
  gmb?: {
    impressions?: number;
    calls?: number;
    directionRequests?: number;
    websiteClicks?: number;
    locations: { name: string; impressions?: number; calls?: number; directions?: number }[];
  };
  createdBy?: mongoose.Types.ObjectId;
  submittedAt?: Date;
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  publishedBy?: mongoose.Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     Report:
 *       type: object
 *       description: >
 *         One report for one client and one period (a week or a month), with the social,
 *         blog, website and Google Business Profile sections inside it. Percent changes shown
 *         next to each number are worked out from the previous period's report, not stored.
 *       properties:
 *         _id:
 *           type: string
 *         client:
 *           type: string
 *           description: Client id
 *         title:
 *           type: string
 *           description: Defaults to "<Month Year> Performance Report" or "Week of <date> Performance Report"
 *           example: August 2026 Performance Report
 *         periodType:
 *           type: string
 *           enum: [weekly, monthly]
 *         periodStart:
 *           type: string
 *           format: date-time
 *         periodEnd:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: [draft, submitted, approved, published]
 *           description: Clients only ever see published reports
 *         summary:
 *           type: string
 *           maxLength: 5000
 *           description: The written summary at the top of the report
 *         social:
 *           type: object
 *           properties:
 *             facebookReach:
 *               type: integer
 *             instagramReach:
 *               type: integer
 *             twitterReach:
 *               type: integer
 *             linkedinReach:
 *               type: integer
 *             videos:
 *               type: array
 *               description: The period's videos, each with its own figures
 *               items:
 *                 type: object
 *                 properties:
 *                   title:
 *                     type: string
 *                   views:
 *                     type: integer
 *                   impressions:
 *                     type: integer
 *             reel:
 *               type: object
 *               description: An older report's single best-performing video — `videos` took its place
 *               properties:
 *                 title:
 *                   type: string
 *                 views:
 *                   type: integer
 *         blogs:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               publishedAt:
 *                 type: string
 *                 format: date-time
 *               graphicsCount:
 *                 type: integer
 *               url:
 *                 type: string
 *         website:
 *           type: object
 *           properties:
 *             impressions:
 *               type: integer
 *             clicks:
 *               type: integer
 *             backlinks:
 *               type: integer
 *             referringDomains:
 *               type: integer
 *             leadsForwarded:
 *               type: integer
 *         gmb:
 *           type: object
 *           description: Google Business Profile
 *           properties:
 *             impressions:
 *               type: integer
 *             calls:
 *               type: integer
 *             directionRequests:
 *               type: integer
 *             websiteClicks:
 *               type: integer
 *             locations:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   impressions:
 *                     type: integer
 *                   calls:
 *                     type: integer
 *                   directions:
 *                     type: integer
 *         createdBy:
 *           type: string
 *         submittedAt:
 *           type: string
 *           format: date-time
 *         approvedBy:
 *           type: string
 *         approvedAt:
 *           type: string
 *           format: date-time
 *         publishedBy:
 *           type: string
 *         publishedAt:
 *           type: string
 *           format: date-time
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

// A count from a platform: a whole number, never negative. Left unset when the
// figure isn't available, which is different from a real zero.
const count = { type: Number, min: [0, "Cannot be negative"], validate: { validator: Number.isInteger, message: "Must be a whole number" } };

const reportSchema = new Schema<IReport>(
  {
    client: { type: Schema.Types.ObjectId, ref: "Client", required: [true, "Client is required"], index: true },
    title: { type: String, trim: true, maxlength: [150, "Title cannot exceed 150 characters"] },
    periodType: { type: String, enum: REPORT_PERIOD_TYPES, required: [true, "Period type is required"] },
    periodStart: { type: Date, required: [true, "Period start is required"] },
    periodEnd: { type: Date, required: [true, "Period end is required"] },
    status: { type: String, enum: REPORT_STATUSES, default: "draft" },
    summary: {
      type: String,
      trim: true,
      maxlength: [REPORT_SUMMARY_MAX_LENGTH, `Summary cannot exceed ${REPORT_SUMMARY_MAX_LENGTH} characters`],
    },

    social: {
      facebookReach: count,
      instagramReach: count,
      twitterReach: count,
      linkedinReach: count,
      videos: {
        type: [
          new Schema(
            {
              title: { type: String, required: [true, "Video title is required"], trim: true },
              views: count,
              impressions: count,
            },
            { _id: false }
          ),
        ],
        default: [],
      },
      reel: {
        title: { type: String, trim: true },
        views: count,
      },
    },

    blogs: {
      type: [
        new Schema(
          {
            title: { type: String, required: [true, "Blog title is required"], trim: true },
            publishedAt: { type: Date },
            graphicsCount: count,
            url: { type: String, trim: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    website: {
      impressions: count,
      clicks: count,
      backlinks: count,
      referringDomains: count,
      leadsForwarded: count,
    },

    gmb: {
      impressions: count,
      calls: count,
      directionRequests: count,
      websiteClicks: count,
      locations: {
        type: [
          new Schema(
            {
              name: { type: String, required: [true, "Location name is required"], trim: true },
              impressions: count,
              calls: count,
              directions: count,
            },
            { _id: false }
          ),
        ],
        default: [],
      },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    submittedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    publishedBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

// One report per client per period, so the same week or month can't be filed twice.
reportSchema.index({ client: 1, periodType: 1, periodStart: 1 }, { unique: true });
// The list a client sees: their published reports, newest first.
reportSchema.index({ client: 1, status: 1, periodStart: -1 });
reportSchema.index({ status: 1, periodStart: -1 });

const formatUtc = (date: Date, options: Intl.DateTimeFormatOptions) =>
  date.toLocaleDateString("en-US", { ...options, timeZone: "UTC" });

export const defaultReportTitle = (type: ReportPeriodType, start: Date) =>
  type === "monthly"
    ? `${formatUtc(start, { month: "long", year: "numeric" })} Performance Report`
    : `Week of ${formatUtc(start, { month: "short", day: "numeric", year: "numeric" })} Performance Report`;

reportSchema.pre("validate", function () {
  if (this.periodStart && this.periodEnd && this.periodEnd < this.periodStart) {
    this.invalidate("periodEnd", "Period end cannot be before period start");
  }
  if (!this.title && this.periodType && this.periodStart) {
    this.title = defaultReportTitle(this.periodType, this.periodStart);
  }
});

// Moving through the review steps stamps when (and by whom) it happened; sending
// a report back to draft clears the steps that no longer hold.
reportSchema.pre("save", function () {
  const actorId = getRequestContext()?.actor?.id;

  if (this.isNew && actorId && !this.createdBy) this.createdBy = new mongoose.Types.ObjectId(actorId);
  if (!this.isModified("status")) return;

  const actor = actorId ? new mongoose.Types.ObjectId(actorId) : undefined;

  if (this.status === "draft") {
    this.submittedAt = undefined;
    this.approvedAt = undefined;
    this.approvedBy = undefined;
    this.publishedAt = undefined;
    this.publishedBy = undefined;
    return;
  }
  if (!this.submittedAt) this.submittedAt = new Date();
  if (this.status === "submitted") {
    this.approvedAt = undefined;
    this.approvedBy = undefined;
    this.publishedAt = undefined;
    this.publishedBy = undefined;
    return;
  }
  if (!this.approvedAt) {
    this.approvedAt = new Date();
    this.approvedBy = actor;
  }
  if (this.status === "approved") {
    this.publishedAt = undefined;
    this.publishedBy = undefined;
    return;
  }
  if (!this.publishedAt) {
    this.publishedAt = new Date();
    this.publishedBy = actor;
  }
});

reportSchema.plugin(auditPlugin, {
  resource: "Report",
  clientField: "client",
  actionByField: { status: "status_changed" },
});

export const Report = mongoose.model<IReport>("Report", reportSchema);
