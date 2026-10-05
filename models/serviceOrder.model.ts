import mongoose, { Schema, Document } from "mongoose";
import { auditPlugin } from "../plugins/auditPlugin";

// A client's order for more services, paid through Stripe Checkout. It's written
// when the client goes to pay (pending) and holds exactly what they chose. The
// services are only added to the client once Stripe says the payment went
// through (paid) — see controllers/payment.controller.ts.

// pending → paid, or expired (the checkout was abandoned) / failed (the payment was declined).
export const SERVICE_ORDER_STATUSES = ["pending", "paid", "expired", "failed"] as const;
export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export interface IServiceOrderItem {
  service: mongoose.Types.ObjectId;
  title: string;
  // The sub-services being added, with the name and price at the time of ordering.
  subServices: { subService: mongoose.Types.ObjectId; name: string; price: number }[];
  total: number;
}

export interface IServiceOrder extends Document {
  client: mongoose.Types.ObjectId;
  // The client-portal user who placed it.
  user?: mongoose.Types.ObjectId;
  items: IServiceOrderItem[];
  // Whole dollars: the first month of what's being added.
  amount: number;
  currency: string;
  status: ServiceOrderStatus;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     ServiceOrder:
 *       type: object
 *       description: A client's order for more services, paid through Stripe. The services are added once it is paid.
 *       properties:
 *         _id: { type: string }
 *         status: { type: string, enum: [pending, paid, expired, failed] }
 *         amount: { type: integer, description: Whole dollars charged — the first month of what was added }
 *         currency: { type: string, example: usd }
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               service: { type: string }
 *               title: { type: string }
 *               total: { type: integer }
 *               subServices:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     subService: { type: string }
 *                     name: { type: string }
 *                     price: { type: integer }
 *         paidAt: { type: string, format: date-time }
 *         createdAt: { type: string, format: date-time }
 */

const orderItemSchema = new Schema<IServiceOrderItem>(
  {
    service: { type: Schema.Types.ObjectId, ref: "Service", required: true },
    title: { type: String, required: true, trim: true },
    subServices: [
      {
        _id: false,
        subService: { type: Schema.Types.ObjectId, required: true },
        name: { type: String, required: true, trim: true },
        price: { type: Number, required: true, min: 0 },
      },
    ],
    total: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const serviceOrderSchema = new Schema<IServiceOrder>(
  {
    client: { type: Schema.Types.ObjectId, ref: "Client", required: [true, "Client is required"], index: true },
    user: { type: Schema.Types.ObjectId, ref: "User" },
    items: { type: [orderItemSchema], validate: { validator: (items: IServiceOrderItem[]) => items.length > 0, message: "An order needs at least one service" } },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "usd" },
    status: { type: String, enum: SERVICE_ORDER_STATUSES, default: "pending" },
    stripeSessionId: { type: String },
    stripePaymentIntentId: { type: String },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

// One order per Stripe Checkout session; the webhook finds it by this.
serviceOrderSchema.index({ stripeSessionId: 1 }, { unique: true, partialFilterExpression: { stripeSessionId: { $type: "string" } } });
serviceOrderSchema.index({ client: 1, createdAt: -1 });

serviceOrderSchema.plugin(auditPlugin, {
  resource: "ServiceOrder",
  clientField: "client",
  actionByField: { status: "status_changed" },
});

export const ServiceOrder = mongoose.model<IServiceOrder>("ServiceOrder", serviceOrderSchema);
