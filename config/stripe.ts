import Stripe from "stripe";
import { env } from "./env";
import { ApiError } from "../utils/ApiError";

let client: Stripe | null = null;

// The Stripe client, made on first use so the API still boots without a key.
export const getStripe = () => {
  if (!env.stripe.secretKey) throw new ApiError(503, "Payments aren't set up yet. Please contact your account manager.");
  if (!client) client = new Stripe(env.stripe.secretKey);
  return client;
};
