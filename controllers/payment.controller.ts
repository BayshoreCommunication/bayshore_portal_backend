import type { Request, Response } from "express";
import mongoose, { type FilterQuery } from "mongoose";
import type Stripe from "stripe";
import { env } from "../config/env";
import { connectDB } from "../config/db";
import { getStripe } from "../config/stripe";
import { ServiceOrder, SERVICE_ORDER_STATUSES, type IServiceOrder, type ServiceOrderStatus } from "../models/serviceOrder.model";
import { ClientService } from "../models/clientService.model";
import { Client } from "../models/client.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { clientScopeFor, visibleClientFilter } from "../utils/clientAccess";
import { addServicesToClient, planFromCatalog, type ServiceChoice } from "../utils/clientServices";

// How a client pays for more services:
//   1. POST /services/me/checkout writes a pending order and opens a Stripe
//      Checkout session for it; the client pays on Stripe's page.
//   2. Stripe calls the webhook below. A paid session marks the order paid and
//      adds its services to the client — whether or not the client ever comes back.
//   3. Back in the portal, GET /services/me/orders/:sessionId shows how it went.
//      If the webhook hasn't landed yet it asks Stripe directly, so the client
//      isn't left waiting on it.
// Card details only ever go to Stripe.

const requireClientAccount = (req: Request) => {
  const clientId = req.user!.client;
  if (!clientId) throw new ApiError(403, "This account is not linked to a client");
  return clientId;
};

const monthlyTotalOf = async (clientId: unknown) =>
  (await ClientService.find({ client: clientId }).select("monthlyPrice").lean()).reduce((sum, entry) => sum + entry.monthlyPrice, 0);

// What the client portal shows for an order.
const orderView = async (order: IServiceOrder) => ({
  _id: order._id,
  status: order.status,
  amount: order.amount,
  currency: order.currency,
  items: order.items,
  paidAt: order.paidAt,
  createdAt: order.createdAt,
  // The client's monthly payment as it stands now (after the order, once it's paid).
  monthlyTotal: await monthlyTotalOf(order.client),
});

// A paid order: its services go to the client, then it's marked paid. Adding is
// repeat-safe, so the webhook and the return page can both get here for the same
// order without doubling anything. The services go first — an order must never
// read "paid" while the client is still waiting for what they bought.
const fulfilOrder = async (order: IServiceOrder, paymentIntentId?: string | null) => {
  if (order.status === "paid") return order;

  const choices: ServiceChoice[] = order.items.map((item) => ({
    service: String(item.service),
    subServices: item.subServices.map((sub) => String(sub.subService)),
  }));
  await addServicesToClient(order.client, choices);

  order.status = "paid";
  order.paidAt = new Date();
  if (paymentIntentId) order.stripePaymentIntentId = paymentIntentId;
  await order.save();
  return order;
};

const paymentIntentIdOf = (session: Stripe.Checkout.Session) =>
  typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

// Brings an order in line with its Stripe session.
const settleFromSession = async (order: IServiceOrder, session: Stripe.Checkout.Session) => {
  if (session.payment_status === "paid") return fulfilOrder(order, paymentIntentIdOf(session));
  if (session.status === "expired" && order.status === "pending") {
    order.status = "expired";
    await order.save();
  }
  return order;
};

// ── The client portal ────────────────────────────────────────────────────────

// Starts paying for more services: checks the choice against the catalog, drops
// what the client already has, writes the order and returns Stripe's payment page.
// What's due is the first month of what's being added.
export const createServiceCheckout = asyncHandler(async (req: Request, res: Response) => {
  const clientId = requireClientAccount(req);

  const planned = await planFromCatalog(req.body.services);
  const existing = await ClientService.find({ client: clientId });

  const items = planned.flatMap(({ service, subServices }) => {
    const have = new Set(existing.find((entry) => String(entry.service) === String(service._id))?.subServices.map((item) => String(item.subService)));
    const adding = subServices.filter((item) => !have.has(String(item.subService)));
    return adding.length
      ? [{ service: service._id, title: service.title, subServices: adding, total: adding.reduce((sum, item) => sum + item.price, 0) }]
      : [];
  });
  if (items.length === 0) throw new ApiError(422, "You already have everything you chose");

  const amount = items.reduce((sum, item) => sum + item.total, 0);
  const order = new ServiceOrder({ client: clientId, user: req.user!._id, items, amount });

  // Nothing to charge (every sub-service chosen is free): no trip to Stripe needed.
  if (amount === 0) {
    await fulfilOrder(order);
    return ApiResponse(res, 201, "Services added successfully", { url: null, order: await orderView(order) });
  }

  const stripe = getStripe();
  await order.save();

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      // Card only. Without the first, Stripe offers every method switched on in the
      // dashboard; without the second, it adds its own Link wallet beside the card form.
      allowed_payment_method_types: ["card"],
      wallet_options: { link: { display: "never" } },
      line_items: items.flatMap((item) =>
        item.subServices.map((sub) => ({
          quantity: 1,
          price_data: {
            currency: order.currency,
            // Stripe counts in cents.
            unit_amount: sub.price * 100,
            product_data: { name: `${item.title} — ${sub.name}`, description: "First month" },
          },
        }))
      ),
      customer_email: req.user!.email || undefined,
      client_reference_id: String(clientId),
      metadata: { orderId: String(order._id) },
      payment_intent_data: { metadata: { orderId: String(order._id) } },
      success_url: `${env.clientPortalUrl}/payments?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.clientPortalUrl}/payments?cancelled=1`,
    });
  } catch (error) {
    // No session, so nothing can ever pay this order — don't leave it hanging.
    order.status = "failed";
    await order.save();
    throw new ApiError(502, `Couldn't start the payment: ${(error as Error).message}`);
  }

  order.stripeSessionId = session.id;
  await order.save();

  return ApiResponse(res, 201, "Checkout started", { url: session.url, order: await orderView(order) });
});

// How an order went, by its Stripe session — for the page the client lands on
// after paying. A still-pending order is checked against Stripe on the spot.
export const getMyServiceOrder = asyncHandler(async (req: Request, res: Response) => {
  const clientId = requireClientAccount(req);

  const order = await ServiceOrder.findOne({ stripeSessionId: req.params.sessionId, client: clientId });
  if (!order) throw new ApiError(404, "Order not found");

  if (order.status === "pending") {
    const session = await getStripe().checkout.sessions.retrieve(req.params.sessionId);
    await settleFromSession(order, session);
  }

  return ApiResponse(res, 200, "Order fetched successfully", await orderView(order));
});

// ── Staff (company portal): the payments clients have made ──────────────────

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A bare date in `to` ("2026-09-30") means the whole of that day.
const createdRange = (from?: string, to?: string): FilterQuery<IServiceOrder>[] => {
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
  return [{ createdAt: range }];
};

// Every order clients have placed for more services, newest first, for the
// clients the caller can see. The summary (counts and money per status, and which
// clients paid the most) covers the client and date range only, so it stays put
// while the table is narrowed by status or search.
export const listPayments = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user!;
  const { client, status, from, to, q } = req.query as Record<string, string | undefined>;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const scope = await visibleClientFilter(requester);
  // Aggregations don't cast ids the way find() does.
  const period: FilterQuery<IServiceOrder>[] = [
    scope,
    ...(client ? [{ client: new mongoose.Types.ObjectId(client) }] : []),
    ...createdRange(from, to),
  ];

  const conditions = [...period];
  if (status) conditions.push({ status });
  // Search matches the client's company name, or a service or sub-service in the order.
  if (q) {
    const search = new RegExp(escapeRegex(q), "i");
    const clientIds = await Client.find({ $and: [{ companyName: search }, clientScopeFor(requester)] }).distinct("_id");
    conditions.push({ $or: [{ client: { $in: clientIds } }, { "items.title": search }, { "items.subServices.name": search }] });
  }
  const filter: FilterQuery<IServiceOrder> = { $and: conditions };

  const [payments, total, byStatus, topClients] = await Promise.all([
    ServiceOrder.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("-__v")
      .populate("client", "companyName contactName")
      .populate("user", "fullName email")
      .lean(),
    ServiceOrder.countDocuments(filter),
    ServiceOrder.aggregate<{ _id: ServiceOrderStatus; count: number; amount: number }>([
      { $match: { $and: period } },
      { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } },
    ]),
    ServiceOrder.aggregate<{ _id: mongoose.Types.ObjectId; amount: number; count: number }>([
      { $match: { $and: [...period, { status: "paid" }] } },
      { $group: { _id: "$client", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const counts = Object.fromEntries(SERVICE_ORDER_STATUSES.map((value) => [value, 0])) as Record<ServiceOrderStatus, number>;
  const amounts = Object.fromEntries(SERVICE_ORDER_STATUSES.map((value) => [value, 0])) as Record<ServiceOrderStatus, number>;
  for (const row of byStatus) {
    counts[row._id] = row.count;
    amounts[row._id] = row.amount;
  }

  const names = new Map(
    (await Client.find({ _id: { $in: topClients.map((row) => row._id) } }).select("companyName").lean()).map((entry) => [String(entry._id), entry.companyName])
  );

  return ApiResponse(res, 200, "Payments fetched successfully", {
    payments,
    summary: {
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      ...counts,
      // Whole dollars: what was actually paid, and what's still waiting on Stripe.
      collected: amounts.paid,
      pendingAmount: amounts.pending,
    },
    topClients: topClients.map((row) => ({ client: row._id, companyName: names.get(String(row._id)) ?? "", amount: row.amount, count: row.count })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// ── Stripe's webhook ─────────────────────────────────────────────────────────

// Mounted in app.ts ahead of express.json(): the signature is checked against the
// exact bytes Stripe sent, so the body must arrive unparsed.
export const stripeWebhook = async (req: Request, res: Response) => {
  if (!env.stripe.webhookSecret) return res.status(503).json({ success: false, message: "Webhook secret is not configured" });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body as Buffer, req.headers["stripe-signature"] as string, env.stripe.webhookSecret);
  } catch (error) {
    // Not from Stripe, or signed with another endpoint's secret.
    return res.status(400).json({ success: false, message: `Webhook signature check failed: ${(error as Error).message}` });
  }

  try {
    if (event.type.startsWith("checkout.session.")) {
      const session = event.data.object as Stripe.Checkout.Session;
      await connectDB();
      const order = await ServiceOrder.findOne({ stripeSessionId: session.id });

      // A session this API didn't create (another product on the same Stripe account) is none of its business.
      if (order) {
        if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
          await settleFromSession(order, session);
        } else if (event.type === "checkout.session.async_payment_failed" && order.status === "pending") {
          order.status = "failed";
          await order.save();
        } else if (event.type === "checkout.session.expired" && order.status === "pending") {
          order.status = "expired";
          await order.save();
        }
      }
    }
  } catch (error) {
    // A 500 makes Stripe send the event again later; fulfilment is repeat-safe.
    console.error("Stripe webhook failed:", error);
    return res.status(500).json({ success: false, message: "Webhook handling failed" });
  }

  return res.status(200).json({ received: true });
};
