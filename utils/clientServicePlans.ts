import mongoose from "mongoose";
import type { IClient, IClientServicePlan } from "../models/client.model";
import type { ServiceChanges } from "./notifications";

// The services the team records on a client (details.services), as the client form sends them
// back on every save. The form doesn't know when each was added or finished — that is kept here,
// carried over from what was saved before — and what changed is worked out for the client's
// notification (notifyServicesUpdated).
//
// A custom service is also the client's project (controllers/project.controller.ts): it gets an
// id of its own (`project`), and what only the project side keeps — its stage, priority, files,
// who asked for it — is carried over too, matched by that id (the form sends it back) or by name.

// What only the project side of a custom service keeps: the form never sends these.
const PROJECT_ONLY = ["stage", "priority", "files", "requestedBy", "createdBy", "startedAt"] as const;

export type Plan = Pick<
  IClientServicePlan,
  "name" | "monthly" | "oneTime" | "included" | "fields" | "deadline" | "duration" | "status" | "addedAt" | "doneAt" | "custom" | "project" | (typeof PROJECT_ONLY)[number]
>;

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
    custom: plan.custom,
    project: plan.project,
    stage: plan.stage,
    priority: plan.priority,
    files: (plan.files ?? []).map(({ url, name, size, mimeType }) => ({ url, name, size, mimeType })),
    requestedBy: plan.requestedBy,
    createdBy: plan.createdBy,
    startedAt: plan.startedAt,
  }));

// Every custom service has its project id. Returns whether one was given.
export const giveProjectIds = (client: IClient) => {
  let given = false;
  for (const plan of client.details?.services ?? []) {
    if (plan.custom && !plan.project) {
      plan.project = new mongoose.Types.ObjectId();
      given = true;
    }
  }
  return given;
};

// After: each service keeps when it was added (a new one, now) and when it was finished, and
// what changed for the client is returned.
export const stampPlans = (client: IClient, before: Plan[]): ServiceChanges => {
  const now = new Date();
  const byName = new Map(before.map((plan) => [keyOf(plan.name), plan]));
  const byProject = new Map(before.filter((plan) => plan.project).map((plan) => [String(plan.project), plan]));
  const changes: ServiceChanges = { added: [], done: [], changed: [], removed: [] };
  const kept = new Set<Plan>();

  for (const plan of client.details?.services ?? []) {
    const previous = (plan.project ? byProject.get(String(plan.project)) : undefined) ?? byName.get(keyOf(plan.name));
    if (previous) kept.add(previous);
    plan.addedAt = previous?.addedAt ?? now;
    // Its project side, which the form doesn't send back.
    if (previous) {
      if (!plan.project && previous.project) plan.project = previous.project;
      const target = plan as unknown as Record<string, unknown>;
      for (const field of PROJECT_ONLY) if (target[field] === undefined && previous[field] !== undefined) target[field] = previous[field];
    }
    if (isDone(plan)) {
      plan.doneAt = isDone(previous) ? (previous?.doneAt ?? now) : now;
    } else {
      plan.status = undefined;
      plan.doneAt = undefined;
      // Taken up again after it was finished: the work is under way.
      if (plan.custom && isDone(previous)) plan.stage = "in_progress";
    }

    if (!previous) changes.added.push(plan.name);
    else if (isDone(plan) && !isDone(previous)) changes.done.push(plan.name);
    // Taken up again after it was finished, or its price or what it covers changed.
    else if (isDone(plan) !== isDone(previous) || lookOf(plan) !== lookOf(previous)) changes.changed.push(plan.name);
  }
  for (const plan of before) if (!kept.has(plan)) changes.removed.push(plan.name);
  giveProjectIds(client);
  return changes;
};

// Files of services taken off (or of files no longer on them): to delete from storage.
export const droppedFiles = (client: IClient, before: Plan[]) => {
  const now = new Set((client.details?.services ?? []).flatMap((plan) => (plan.files ?? []).map((file) => file.url)));
  return before.flatMap((plan) => (plan.files ?? []).map((file) => file.url)).filter((url) => !now.has(url));
};
