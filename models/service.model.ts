import mongoose, { Schema, Document } from "mongoose";
import { auditPlugin } from "../plugins/auditPlugin";
import { getRequestContext } from "../utils/requestContext";

// The catalog: every service BayShore offers. A main service ("SEO & Website
// Optimization") is made of sub-services ("Backlink outreach"), each with its own
// monthly price; the service's price is their sum. Which client takes which
// service — and what that client pays a month — is in clientService.model.ts.

export const SERVICE_PLANS = ["growth", "core"] as const;
export type ServicePlan = (typeof SERVICE_PLANS)[number];

export const SERVICE_TITLE_MAX_LENGTH = 80;
export const SERVICE_DESCRIPTION_MAX_LENGTH = 200;
export const SUB_SERVICE_NAME_MAX_LENGTH = 100;
// Monthly prices are whole dollars. The cap is a sanity check, not a business rule.
export const SUB_SERVICE_MAX_PRICE = 100000;
export const SERVICE_MAX_SUB_SERVICES = 50;

export interface ISubService {
  // Kept when a sub-service is renamed or re-priced, so the clients who take it
  // can be brought along.
  _id: mongoose.Types.ObjectId;
  name: string;
  price: number;
}

export interface IService extends Document {
  title: string;
  // The title lower-cased, so "SEO" and "seo" can't both exist.
  titleKey: string;
  description?: string;
  plan: ServicePlan;
  // The service's own color in the portals (its icon tile, its bar in a chart).
  color?: string;
  subServices: mongoose.Types.DocumentArray<ISubService>;
  // The sum of the sub-services' prices; worked out on save.
  monthlyPrice: number;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     SubService:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         name: { type: string, maxLength: 100, example: Backlink outreach }
 *         price: { type: integer, minimum: 0, description: Whole dollars a month, example: 300 }
 *     Service:
 *       type: object
 *       description: A service in BayShore's catalog. Only a superadmin adds or changes one.
 *       properties:
 *         _id: { type: string }
 *         title: { type: string, maxLength: 80, example: SEO & Website Optimization }
 *         description: { type: string, maxLength: 200 }
 *         plan: { type: string, enum: [growth, core] }
 *         color: { type: string, example: "#c8973a" }
 *         subServices:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SubService'
 *         monthlyPrice: { type: integer, description: Sum of the sub-services' prices. Read-only. }
 *         createdBy: { type: string }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 */

const subServiceSchema = new Schema<ISubService>({
  name: {
    type: String,
    required: [true, "Every sub-service needs a name"],
    trim: true,
    maxlength: [SUB_SERVICE_NAME_MAX_LENGTH, `A sub-service name cannot exceed ${SUB_SERVICE_NAME_MAX_LENGTH} characters`],
  },
  price: {
    type: Number,
    required: [true, "Every sub-service needs a monthly price"],
    min: [0, "A price cannot be negative"],
    max: [SUB_SERVICE_MAX_PRICE, `A sub-service cannot cost more than $${SUB_SERVICE_MAX_PRICE} a month`],
    validate: { validator: Number.isInteger, message: "Prices are whole dollars" },
  },
});

const serviceSchema = new Schema<IService>(
  {
    title: {
      type: String,
      required: [true, "Service name is required"],
      trim: true,
      maxlength: [SERVICE_TITLE_MAX_LENGTH, `Service name cannot exceed ${SERVICE_TITLE_MAX_LENGTH} characters`],
    },
    titleKey: { type: String, unique: true, select: false },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [SERVICE_DESCRIPTION_MAX_LENGTH, `Description cannot exceed ${SERVICE_DESCRIPTION_MAX_LENGTH} characters`],
    },
    plan: { type: String, enum: SERVICE_PLANS, default: "core" },
    color: { type: String, trim: true, match: [/^#[0-9a-fA-F]{6}$/, "Color must be a hex color like #c8973a"] },
    subServices: {
      type: [subServiceSchema],
      validate: [
        { validator: (items: ISubService[]) => items.length > 0, message: "Add at least one sub-service" },
        {
          validator: (items: ISubService[]) => items.length <= SERVICE_MAX_SUB_SERVICES,
          message: `A service can have at most ${SERVICE_MAX_SUB_SERVICES} sub-services`,
        },
      ],
    },
    monthlyPrice: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    // titleKey is bookkeeping; `select: false` keeps it out of reads, this keeps it
    // out of a freshly saved service's response too.
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.titleKey;
        return ret;
      },
    },
  }
);

serviceSchema.index({ title: 1 });

serviceSchema.pre("validate", function () {
  this.titleKey = (this.title ?? "").trim().toLowerCase();

  // A client's sub-services are told apart by name in both portals.
  const names = this.subServices.map((item) => (item.name ?? "").trim().toLowerCase());
  const repeated = names.find((name, index) => name && names.indexOf(name) !== index);
  if (repeated) this.invalidate("subServices", `"${this.subServices[names.indexOf(repeated)].name}" is listed twice`);

  this.monthlyPrice = this.subServices.reduce((sum, item) => sum + (Number.isFinite(item.price) ? item.price : 0), 0);
});

serviceSchema.pre("save", function () {
  const actorId = getRequestContext()?.actor?.id;
  if (this.isNew && actorId && !this.createdBy) this.createdBy = new mongoose.Types.ObjectId(actorId);
});

serviceSchema.plugin(auditPlugin, { resource: "Service" });

export const Service = mongoose.model<IService>("Service", serviceSchema);
