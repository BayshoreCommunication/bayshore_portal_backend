import type { Schema } from "mongoose";
import type { AuditAction, AuditChange } from "../models/auditLog.model";
import {
  DEFAULT_IGNORED_FIELDS,
  DEFAULT_SENSITIVE_FIELDS,
  diffRecords,
  logAudit,
  redact,
} from "../utils/audit";

export interface AuditPluginOptions {
  // Name stored in the log, e.g. "User", "Client", "Report".
  resource: string;
  // Field on this model that points at a Client, so the entry can be filtered by client.
  clientField?: string;
  sensitiveFields?: string[];
  ignoredFields?: string[];
  // Gives a specific action name when a given field changes, e.g. { role: "role_changed" }.
  actionByField?: Record<string, AuditAction>;
}

type Loose = any; // Mongoose's hook typings differ per hook; the shapes used below are checked by hand.
type Lean = Record<string, unknown> & { _id: unknown };

// Bulk updates/deletes are looked up before running so they can be logged; cap
// that lookup so one careless updateMany can't load the whole collection.
const MAX_BULK_DOCS = 200;

const SINGLE_DOC_OPS = ["updateOne", "findOneAndUpdate", "findOneAndDelete", "deleteOne"] as const;
const BULK_OPS = ["updateMany", "deleteMany"] as const;
const DELETE_OPS = ["findOneAndDelete", "deleteOne", "deleteMany"];

/**
 * Records create / update / delete for every model it is applied to, with the
 * acting user taken from the request context. Covers document saves
 * and the query helpers (updateOne, findOneAndUpdate,
 * deleteMany, ...), so controllers don't have to remember to log.
 *
 * Not covered: Model.insertMany(), bulkWrite() and raw driver calls, which
 * skip Mongoose middleware. Log those explicitly with logAudit().
 */
export const auditPlugin = (schema: Schema, options: AuditPluginOptions) => {
  const { resource, clientField, actionByField = {} } = options;
  const sensitive = options.sensitiveFields ?? DEFAULT_SENSITIVE_FIELDS;
  const ignored = options.ignoredFields ?? [...DEFAULT_IGNORED_FIELDS, "lastLoginAt"];

  // Select:false fields (like password) are hidden from lean reads, which would
  // hide their changes from the diff — pull them in explicitly.
  const includeSensitive = sensitive.filter((field) => schema.path(field)).map((field) => `+${field}`);
  const withSensitive = (query: Loose) => (includeSensitive.length ? query.select(includeSensitive.join(" ")) : query);

  const labelOf = (record: Record<string, unknown>) => {
    const label = record.fullName ?? record.companyName ?? record.name ?? record.title ?? record.email;
    return typeof label === "string" && label ? ` "${label}"` : "";
  };

  const clientOf = (record: Record<string, unknown>) => (clientField ? record[clientField] : undefined);

  const actionFor = (changes: AuditChange[]): AuditAction => {
    for (const change of changes) {
      if (actionByField[change.field]) return actionByField[change.field];
    }
    return "update";
  };

  const logUpdate = async (before: Lean, after: Lean, only?: string[]) => {
    const changes = diffRecords(before, after, { sensitive, ignored, only });
    if (changes.length === 0) return;

    await logAudit({
      action: actionFor(changes),
      resource,
      resourceId: after._id,
      client: clientOf(after),
      summary: `Updated ${resource}${labelOf(after)} (${changes.map((c) => c.field).join(", ")})`,
      changes,
    });
  };

  const logCreate = (record: Lean) =>
    logAudit({
      action: "create",
      resource,
      resourceId: record._id,
      client: clientOf(record),
      summary: `Created ${resource}${labelOf(record)}`,
      snapshot: redact(record, sensitive),
    });

  const logDelete = (record: Lean) =>
    logAudit({
      action: "delete",
      resource,
      resourceId: record._id,
      client: clientOf(record),
      summary: `Deleted ${resource}${labelOf(record)}`,
      snapshot: redact(record, sensitive),
    });

  // ── Document middleware: doc.save() ────────────────────────────────────────

  schema.pre("save", async function (this: Loose) {
    this.$locals.auditIsNew = this.isNew;
    if (this.isNew) return;

    const paths = Array.from(new Set(this.modifiedPaths().map((path: string) => path.split(".")[0]))).filter(
      (path) => !ignored.includes(path as string)
    );
    this.$locals.auditPaths = paths;
    if (paths.length === 0) return;

    this.$locals.auditBefore = await withSensitive(this.constructor.findById(this._id)).lean();
  });

  schema.post("save", async function (this: Loose, doc: Loose) {
    const locals = doc.$locals;
    if (locals.auditIsNew) {
      await logCreate(doc.toObject());
      return;
    }
    if (!locals.auditBefore) return;
    await logUpdate(locals.auditBefore, doc.toObject(), locals.auditPaths);
  });

  // ── Query middleware: updateOne(), findOneAndUpdate(), deleteMany(), doc.deleteOne() ... ──
  // (doc.deleteOne() runs through the deleteOne query hook as well, so it needs no hook of its own.)

  const beforeByQuery = new WeakMap<object, Lean[]>();

  // Skip the lookup entirely when an update only touches bookkeeping fields.
  const touchesOnlyIgnored = (query: Loose) => {
    const update = query.getUpdate?.();
    if (!update || Array.isArray(update)) return false;
    const keys = Object.entries(update).flatMap(([key, value]) =>
      key.startsWith("$") && value && typeof value === "object" ? Object.keys(value) : [key]
    );
    return keys.length > 0 && keys.every((key) => ignored.includes(key.split(".")[0]));
  };

  for (const op of [...SINGLE_DOC_OPS, ...BULK_OPS]) {
    const isBulk = (BULK_OPS as readonly string[]).includes(op);

    schema.pre(op as Loose, async function (this: Loose) {
      if (!DELETE_OPS.includes(op) && touchesOnlyIgnored(this)) return;
      const docs = await withSensitive(this.model.find(this.getFilter()))
        .limit(isBulk ? MAX_BULK_DOCS : 1)
        .lean();
      beforeByQuery.set(this, docs);
    });

    schema.post(op as Loose, async function (this: Loose) {
      const before = beforeByQuery.get(this);
      beforeByQuery.delete(this);
      if (!before?.length) return;

      if (DELETE_OPS.includes(op)) {
        await Promise.all(before.map(logDelete));
        return;
      }

      const afterDocs: Lean[] = await withSensitive(
        this.model.find({ _id: { $in: before.map((doc) => doc._id) } })
      ).lean();
      const afterById = new Map(afterDocs.map((doc) => [String(doc._id), doc]));

      await Promise.all(
        before.map((doc) => {
          const after = afterById.get(String(doc._id));
          return after ? logUpdate(doc, after) : undefined;
        })
      );
    });
  }
};
