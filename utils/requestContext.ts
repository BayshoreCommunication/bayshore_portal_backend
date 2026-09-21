import { AsyncLocalStorage } from "async_hooks";

export interface AuditActor {
  id: string;
  name: string;
  role: string;
}

export interface RequestContext {
  actor?: AuditActor;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);

export const getRequestContext = (): RequestContext | undefined => storage.getStore();

// Called by the auth middleware once the caller is known, so anything that
// writes to the database later in this request can be attributed to them.
export const setContextActor = (user: { _id: unknown; fullName: string; role: string }) => {
  const store = storage.getStore();
  if (store) store.actor = { id: String(user._id), name: user.fullName, role: user.role };
};
