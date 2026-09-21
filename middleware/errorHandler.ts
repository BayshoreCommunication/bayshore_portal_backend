import type { ErrorRequestHandler } from "express";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  let error: ApiError;

  if (err.name === "CastError") {
    error = new ApiError(400, `Invalid value for field: ${err.path}`);
  } else if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map(
      (val: any) => val.message as string
    );
    error = new ApiError(422, "Validation failed", messages);
  } else if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0];
    error = new ApiError(409, `Duplicate value for field: ${field}`);
  } else if (err.name === "MulterError") {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "File is too large (max 5MB)"
        : err.message;
    error = new ApiError(400, message);
  } else if (err instanceof ApiError) {
    error = err;
  } else {
    error = new ApiError(err.statusCode || 500, err.message || "Internal Server Error");
  }

  if (!env.isProduction) {
    console.error(err);
  }

  res.status(error.statusCode).json({
    success: false,
    message: error.message,
    errors: error.errors,
    ...(env.isProduction ? {} : { stack: err.stack }),
  });
};
