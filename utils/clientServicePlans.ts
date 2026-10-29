import type { IClient, IClientServicePlan } from "../models/client.model";
import type { ServiceChanges } from "./notifications";

// The services the team records on a client (details.services), as the client form sends them
// back on every save. The form doesn't know when each was added or finished — that is kept here,
// carried over by name from what was saved before — and what changed is worked out for the
// client's notification (notifyServicesUpdated).

type Plan = Pick<IClientServicePlan, "name" | "monthly" | "oneTime" | "included" | "fields" | "deadline" | "duration" | "status" | "addedAt" | "doneAt">;

const keyOf = (name: string) => name.trim().toLowerCase();
const isDone = (plan?: Plan) => plan?.status === "done";

// What the client sees of it: its price, how often, what it covers and when it is due.
const lookOf = (plan: Plan) =>
  JSON.stringify([plan.monthly ?? 0, plan.oneTime ?? 0, plan.included ?? [], (plan.fields ?? []).map((field) => [field.label, field.value]), plan.deadline ?? "", plan.duration ?? ""]);

// Before the form's services replace the old ones: a copy of those.
export const plansOf = (client: IClient): Plan[] =>
  (client.details?.services ?? []).map((plan) => ({
    name: plan.name,
    monthly: plan.monthly,
    oneTime: plan.oneTime,
    included: [...(plan.included ?? [])],
    fields: (plan.fields ?? []).map(({ label, value }) => ({ label, value })),
    deadline: plan.deadline,
    duration: plan.duration,
    status: plan.status,
    addedAt: plan.addedAt,
    doneAt: plan.doneAt,
  }));

// After: each service keeps when it was added (a new one, now) and when it was finished, and
// what changed for the client is returned.
export const stampPlans = (client: IClient, before: Plan[]): ServiceChanges => {
  const now = new Date();
  const old = new Map(before.map((plan) => [keyOf(plan.name), plan]));
  const changes: ServiceChanges = { added: [], done: [], changed: [], removed: [] };
  const kept = new Set<string>();

  for (const plan of client.details?.services ?? []) {
    const key = keyOf(plan.name);
    const previous = old.get(key);
    kept.add(key);
    plan.addedAt = previous?.addedAt ?? now;
    if (isDone(plan)) {
      plan.doneAt = isDone(previous) ? (previous?.doneAt ?? now) : now;
    } else {
      plan.status = undefined;
      plan.doneAt = undefined;
    }

    if (!previous) changes.added.push(plan.name);
    else if (isDone(plan) && !isDone(previous)) changes.done.push(plan.name);
    // Taken up again after it was finished, or its price or what it covers changed.
    else if (isDone(plan) !== isDone(previous) || lookOf(plan) !== lookOf(previous)) changes.changed.push(plan.name);
  }
  for (const plan of before) if (!kept.has(keyOf(plan.name))) changes.removed.push(plan.name);
  return changes;
};
