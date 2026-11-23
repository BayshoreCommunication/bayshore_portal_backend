import { env } from "../config/env";
import { taskManagerAuthEnabled } from "./taskManagerAuth";

// Mirroring a company-portal project into the task manager: when one is opened here, the task
// manager makes a matching Project and a starter Task (api/ext/projects). Managed from the
// backend — a failure never blocks the company project; it just isn't mirrored this time.

export interface SyncedProject {
  projectId: string;
  taskId: string;
}

// Create the task manager's Project + Task for a company project. Returns the ids, or null when
// delegation isn't configured or the task manager can't be reached. Never throws.
export const createTaskManagerProject = async (input: { name: string; description?: string; status?: string; color?: string; assignees?: string[] }): Promise<SyncedProject | null> => {
  if (!taskManagerAuthEnabled()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${env.taskManager.url}/api/ext/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.taskManager.ssoKey },
      body: JSON.stringify({ name: input.name, description: input.description ?? "", status: input.status, color: input.color, assignees: input.assignees ?? [] }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<SyncedProject>;
    return data.projectId && data.taskId ? { projectId: data.projectId, taskId: data.taskId } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
