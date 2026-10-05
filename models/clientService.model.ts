import mongoose, { Schema, Document } from "mongoose";
import { auditPlugin } from "../plugins/auditPlugin";
import { getRequestContext } from "../utils/requestContext";

// One catalog service a client takes: which of its sub-services are included,
// and so what the client pays for it each month. A client's monthly payment is
// the sum of `monthlyPrice` across their services.
//
// Each included sub-service carries a copy of its name and price. The copies are
// kept in step with the catalog (see syncClientServices in the service
// controller), so reading a client's services never needs the catalog, and
// `monthlyPrice` can be summed and sorted in the database.

// Who gave the client this service: the team, or the client themselves from their portal.
export const CLIENT_SERVICE_SOURCES = ["client", "team"] as const;
export type ClientServiceSource = (typeof CLIENT_SERVICE_SOURCES)[number];

export interface IClientSubService {
  // The catalog sub-service this is (Service.subServices._id).
  subService: mongoose.Types.ObjectId;
  name: string;
  price: number;
}

export interface IClientService extends Document {
  client: mongoose.Types.ObjectId;
  service: mongoose.Types.ObjectId;
  subServices: IClientSubService[];
  // The sum of the included sub-services' prices; worked out on save.
  monthlyPrice: number;
  addedBy: ClientServiceSource;
  assignedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     ClientService:
 *       type: object
 *       description: A catalog service a client takes, with the sub-services included and what it costs them a month.
 *       properties:
 *         _id: { type: string }
 *         client: { type: string }
 *         service:
 *           $ref: '#/components/schemas/Service'
 *         subServices:
 *           type: array
 *           description: The included sub-services
 *           items:
 *             type: object
 *             properties:
 *               subService: { type: string, description: The catalog sub-service's id }
 *               name: { type: string }
 *               price: { type: integer }
 *         monthlyPrice: { type: integer, description: What the client pays a month for this service. Read-only. }
 *         addedBy: { type: string, enum: [client, team], description: Whether the client added it from their portal or the team did }
 *         createdAt: { type: string, format: date-time, description: When the client started taking it }
 *         updatedAt: { type: string, format: date-time }
 */

const clientSubServiceSchema = new Schema<IClientSubService>(
  {
    subService: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const clientServiceSchema = new Schema<IClientService>(
  {
    client: { type: Schema.Types.ObjectId, ref: "Client", required: [true, "Client is required"], index: true },
    service: { type: Schema.Types.ObjectId, ref: "Service", required: [true, "Service is required"], index: true },
    subServices: {
      type: [clientSubServiceSchema],
      validate: { validator: (items: IClientSubService[]) => items.length > 0, message: "Include at least one sub-service" },
    },
    monthlyPrice: { type: Number, default: 0 },
    addedBy: { type: String, enum: CLIENT_SERVICE_SOURCES },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// A client takes a service once.
clientServiceSchema.index({ client: 1, service: 1 }, { unique: true });

clientServiceSchema.pre("validate", function () {
  this.monthlyPrice = this.subServices.reduce((sum, item) => sum + (Number.isFinite(item.price) ? item.price : 0), 0);
});

clientServiceSchema.pre("save", function () {
  if (!this.isNew) return;
  const actor = getRequestContext()?.actor;
  if (actor && !this.assignedBy) this.assignedBy = new mongoose.Types.ObjectId(actor.id);
  if (!this.addedBy) this.addedBy = actor?.role === "client" ? "client" : "team";
});

clientServiceSchema.plugin(auditPlugin, { resource: "ClientService", clientField: "client" });

export const ClientService = mongoose.model<IClientService>("ClientService", clientServiceSchema);
