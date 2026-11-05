export class ApiError extends Error {
  statusCode: number;
  errors: string[];
  // More for the caller to act on (e.g. the id of what already exists), sent as `data`.
  data?: unknown;

  constructor(statusCode: number, message: string, errors: string[] = [], data?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.data = data;
    Error.captureStackTrace(this, this.constructor);
  }
}
