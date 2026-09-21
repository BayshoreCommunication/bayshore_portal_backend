import { isDeepStrictEqual } from "util";
import { AuditLog, type AuditAction, type AuditChange } from "../models/auditLog.model";
import { getRequestContext, type AuditActor } from "./requestContext";

export const REDACTED = "[redacted]";

// Never written to the log in readable form.
export const DEFAULT_SENSITIVE_FIELDS = [
  "password",
  "tokenHash",
  "replacedByTokenHash",
  "refreshToken",
  "accessToken",
];

// Bookkeeping fields that would only add noise to a diff.
export const DEFAULT_IGNORED_FIELDS = ["_id", "__v", "createdAt", "updatedAt"];

const MAX_STRING_LENGTH = 300;

// JSON round-trip turns ObjectIds and Dates into plain, comparable values.
const toPlain = (value: unknown): unknown => {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
};

export const redact = (
  record: Record<string, unknown>,
  sensitive: string[] = DEFAULT_SENSITIVE_FIELDS
): Record<string, unknown> => {
  const plain = toPlain(record) as Record<string, unknown>;
  for (const field of sensitive) delete plain[field];
  delete plain.__v;
  return plain;
};

export const diffRecords = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  options: { sensitive?: string[]; ignored?: string[]; only?: string[] } = {}
): AuditChange[] => {
  const sensitive = options.sensitive ?? DEFAULT_SENSITIVE_FIELDS;
  const ignored = options.ignored ?? DEFAULT_IGNORED_FIELDS;
  const fields = options.only ?? Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));

  const changes: AuditChange[] = [];
  for (const field of fields) {
    if (ignored.includes(field)) continue;
    const previous = toPlain(before[field]);
    const next = toPlain(after[field]);
    if (isDeepStrictEqual(previous, next)) continue;

    changes.push(
      sensitive.includes(field)
        ? { field, before: REDACTED, after: REDACTED }
        : { field, before: previous, after: next }
    );
  }
  return changes;
};

export interface LogAuditInput {
  action: AuditAction;
  resource: string;
  resourceId?: unknown;
  client?: unknown;
  summary?: string;
  changes?: AuditChange[];
  snapshot?: unknown;
  details?: Record<string, unknown>;
  // Defaults to whoever the current request is authenticated as. Pass an actor
  // explicitly when there is no authenticated request yet (sign-in), or null
  // for an anonymous event.
  actor?: AuditActor | null;
}

/**
 * Writes one audit entry. A failure here is logged but never thrown — a broken
 * audit write must not undo or block the change the user actually asked for.
 */
export const logAudit = async (input: LogAuditInput): Promise<void> => {
  try {
    const context = getRequestContext();
    const actor = input.actor === undefined ? context?.actor : (input.actor ?? undefined);

    await AuditLog.create({
      actor: actor?.id,
      actorName: actor?.name,
      actorRole: actor?.role,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      client: input.client,
      summary: input.summary?.slice(0, MAX_STRING_LENGTH),
      changes: input.changes ?? [],
      snapshot: input.snapshot,
      details: input.details,
      ip: context?.ip,
      userAgent: context?.userAgent,
    });
  } catch (error) {
    console.error("Audit log write failed:", error);
  }
};
