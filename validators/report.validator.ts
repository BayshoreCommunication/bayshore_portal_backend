import { body, param, query, type ValidationChain } from "express-validator";
import { REPORT_PERIOD_TYPES, REPORT_STATUSES, REPORT_SUMMARY_MAX_LENGTH } from "../models/report.model";

export const reportIdRule: ValidationChain[] = [param("id").isMongoId().withMessage("Invalid report id")];

// A platform figure: a whole number, 0 or more. `null` is accepted so a figure can be cleared.
const metric = (path: string) =>
  body(path)
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage(`${path} must be a whole number, 0 or more`)
    .toInt();

const section = (path: string) =>
  body(path).optional().isObject().withMessage(`${path} must be an object`);

// Everything a report holds besides which client and period it is for.
const contentRules: ValidationChain[] = [
  body("title").optional().isString().trim().isLength({ max: 150 }).withMessage("Title cannot exceed 150 characters"),
  body("summary")
    .optional()
    .isString()
    .withMessage("Summary must be text")
    .isLength({ max: REPORT_SUMMARY_MAX_LENGTH })
    .withMessage(`Summary cannot exceed ${REPORT_SUMMARY_MAX_LENGTH} characters`),

  section("social"),
  metric("social.facebookReach"),
  metric("social.instagramReach"),
  metric("social.twitterReach"),
  metric("social.linkedinReach"),
  body("social.videos").optional().isArray({ max: 100 }).withMessage("social.videos must be a list of at most 100 items"),
  body("social.videos.*.title")
    .isString()
    .withMessage("Each video needs a title")
    .trim()
    .notEmpty()
    .withMessage("Each video needs a title")
    .isLength({ max: 300 }),
  metric("social.videos.*.views"),
  metric("social.videos.*.impressions"),
  // An older report's single best-performing video; `social.videos` took its place.
  body("social.reel").optional().isObject().withMessage("social.reel must be an object"),
  body("social.reel.title").optional().isString().trim().isLength({ max: 300 }),
  metric("social.reel.views"),

  body("blogs").optional().isArray({ max: 100 }).withMessage("blogs must be a list of at most 100 items"),
  body("blogs.*.title")
    .isString()
    .withMessage("Each blog needs a title")
    .trim()
    .notEmpty()
    .withMessage("Each blog needs a title")
    .isLength({ max: 300 }),
  body("blogs.*.publishedAt").optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage("Blog publishedAt must be a valid date"),
  metric("blogs.*.graphicsCount"),
  body("blogs.*.url").optional({ checkFalsy: true }).isURL().withMessage("Blog url must be a valid URL"),

  section("website"),
  metric("website.impressions"),
  metric("website.clicks"),
  metric("website.backlinks"),
  metric("website.referringDomains"),
  metric("website.leadsForwarded"),

  section("gmb"),
  metric("gmb.impressions"),
  metric("gmb.calls"),
  metric("gmb.directionRequests"),
  metric("gmb.websiteClicks"),
  body("gmb.locations").optional().isArray({ max: 50 }).withMessage("gmb.locations must be a list of at most 50 items"),
  body("gmb.locations.*.name")
    .isString()
    .withMessage("Each location needs a name")
    .trim()
    .notEmpty()
    .withMessage("Each location needs a name")
    .isLength({ max: 150 }),
  metric("gmb.locations.*.impressions"),
  metric("gmb.locations.*.calls"),
  metric("gmb.locations.*.directions"),
];

const periodOrderRule = body().custom((_value, { req }) => {
  const { periodStart, periodEnd } = req.body;
  if (periodStart && periodEnd && new Date(periodEnd) < new Date(periodStart)) {
    throw new Error("Period end cannot be before period start");
  }
  return true;
});

export const createReportRules: ValidationChain[] = [
  body("client").isMongoId().withMessage("A valid client is required"),
  body("periodType").isIn(REPORT_PERIOD_TYPES).withMessage(`periodType must be one of: ${REPORT_PERIOD_TYPES.join(", ")}`),
  body("periodStart").isISO8601().withMessage("periodStart must be a valid date"),
  body("periodEnd").isISO8601().withMessage("periodEnd must be a valid date"),
  periodOrderRule,
  ...contentRules,
];

export const updateReportRules: ValidationChain[] = [
  body("periodType").optional().isIn(REPORT_PERIOD_TYPES).withMessage(`periodType must be one of: ${REPORT_PERIOD_TYPES.join(", ")}`),
  body("periodStart").optional().isISO8601().withMessage("periodStart must be a valid date"),
  body("periodEnd").optional().isISO8601().withMessage("periodEnd must be a valid date"),
  periodOrderRule,
  ...contentRules,
];

export const changeStatusRules: ValidationChain[] = [
  body("status").isIn(REPORT_STATUSES).withMessage(`status must be one of: ${REPORT_STATUSES.join(", ")}`),
];

const paging: ValidationChain[] = [
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];

const periodFilters: ValidationChain[] = [
  query("periodType").optional().isIn(REPORT_PERIOD_TYPES).withMessage(`periodType must be one of: ${REPORT_PERIOD_TYPES.join(", ")}`),
  query("from").optional().isISO8601().withMessage("from must be a valid date"),
  query("to").optional().isISO8601().withMessage("to must be a valid date"),
  query("q").optional().isString().trim().isLength({ max: 100 }),
];

export const listReportsRules: ValidationChain[] = [
  query("client").optional().isMongoId().withMessage("client must be a valid id"),
  query("status").optional().isIn(REPORT_STATUSES).withMessage(`status must be one of: ${REPORT_STATUSES.join(", ")}`),
  ...periodFilters,
  ...paging,
];

export const listMyReportsRules: ValidationChain[] = [
  ...periodFilters,
  ...paging,
  query("full").optional().isBoolean().withMessage("full must be true or false"),
];
