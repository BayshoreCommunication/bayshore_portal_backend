import crypto from "crypto";
import { env } from "../config/env";
import { User, EMAIL_REGEX, USER_ROLES, type IUser, type UserRole } from "../models/user.model";

// Signing in to the company portal with a task-manager account. The company portal and its
// sign-in route are unchanged: it still posts the email and password to the backend's /auth/signin.
// When no local user matches, the backend asks the task manager whether the credentials are good
// (POST /api/ext/verify-credentials, key-guarded), and if so keeps a local user for that person —
// so their role and access live here, in the backend, like any other user.

export const taskManagerAuthEnabled = () => Boolean(env.taskManager.url && env.taskManager.ssoKey);

export interface TaskManagerUser {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar: string | null;
}

// The task manager's roles → the backend's. The shared ones map across as-is; anything unexpected
// is given the least privilege.
const ROLE_MAP: Record<string, UserRole> = {
  admin: "admin",
  o_level: "o_level",
  manager: "manager",
  assistant_manager: "assistant_manager",
  executive: "executive",
};
export const mapTaskManagerRole = (role: string): UserRole =>
  ROLE_MAP[role] ?? (USER_ROLES.includes(role as UserRole) ? (role as UserRole) : "executive");

// Ask the task manager whether this email + password is one of its users. Returns the user when
// they are, null when they aren't (or the task manager can't be reached — a local-only sign-in
// then simply fails as before). Never throws.
export const verifyWithTaskManager = async (email: string, password: string): Promise<TaskManagerUser | null> => {
  if (!taskManagerAuthEnabled()) return null;
  if (!EMAIL_REGEX.test(email)) return null; // the task manager keys on email only

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${env.taskManager.url}/api/ext/verify-credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.taskManager.ssoKey },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });
    if (!response.ok) return null; // 401 wrong creds, 404 wrong/disabled key, etc.
    const data = (await response.json()) as { ok?: boolean; user?: TaskManagerUser };
    if (!data?.ok || !data.user?.email) return null;
    return data.user;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

// The local user for a verified task-manager account: created the first time, and kept in step
// with the task manager (name, role, avatar) on later sign-ins. Its password field is a random
// placeholder — these accounts are always re-verified against the task manager, never locally.
export const provisionTaskManagerUser = async (tm: TaskManagerUser): Promise<IUser> => {
  const email = tm.email.trim().toLowerCase();
  const role = mapTaskManagerRole(tm.role);
  const existing = await User.findOne({ email }).select("+password");

  if (existing) {
    // Keep a local account that already delegates in step with the task manager.
    if (existing.authSource === "taskmanager") {
      existing.fullName = tm.name || existing.fullName;
      existing.role = role;
      if (tm.avatar) existing.avatar = tm.avatar;
      await existing.save();
    }
    return existing;
  }

  const user = new User({
    fullName: tm.name || email,
    email,
    role,
    authSource: "taskmanager",
    status: "active",
    avatar: tm.avatar ?? undefined,
    // Never used for sign-in (these accounts delegate), but the schema requires one.
    password: crypto.randomBytes(24).toString("hex"),
  });
  await user.save();
  return user;
};

// The task manager's team (non-muted), for the meeting participant picker. Empty if delegation
// isn't configured or the task manager can't be reached — the caller then shows no one.
export interface TaskManagerTeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar: string | null;
  designation?: string;
  department?: string;
}

export const taskManagerTeam = async (): Promise<TaskManagerTeamMember[]> => {
  if (!taskManagerAuthEnabled()) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${env.taskManager.url}/api/ext/team`, {
      headers: { "x-api-key": env.taskManager.ssoKey },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { members?: TaskManagerTeamMember[] };
    return (data.members ?? []).filter((member) => member.email);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
};
