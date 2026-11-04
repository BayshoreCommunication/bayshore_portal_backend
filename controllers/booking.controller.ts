import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { Client } from "../models/client.model";
import { ApiError } from "../utils/ApiError";
import { ApiResponse } from "../utils/ApiResponse";
import { bookCall, bookingFor } from "../utils/booking";

// A signed-in client booking their onboarding call in the portal (utils/booking.ts).

// GET /onboarding/me/booking — the free times, and the call already booked if there is one.
export const getMyBooking = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.client) throw new ApiError(404, "There is no client record for this account");
  try {
    return ApiResponse(res, 200, "Booking fetched", await bookingFor(req.user.client));
  } catch (error) {
    console.error("Booking: couldn't read the free times:", error instanceof Error ? error.message : error);
    // The Google booking page is still there to use.
    return ApiResponse(res, 200, "Booking fetched", { available: false, booked: null });
  }
});

// POST /onboarding/me/booking — book the call at `start` (one of the free times), or move it there.
export const bookMyCall = asyncHandler(async (req: Request, res: Response) => {
  const client = req.user?.client ? await Client.findById(req.user.client) : null;
  if (!client) throw new ApiError(404, "There is no client record for this account");
  try {
    return ApiResponse(res, 200, "Call booked", await bookCall(client, new Date(req.body.start)));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("Booking: couldn't book the call:", error instanceof Error ? error.message : error);
    throw new ApiError(502, "We couldn't book that time just now. Please try again in a moment.");
  }
});
