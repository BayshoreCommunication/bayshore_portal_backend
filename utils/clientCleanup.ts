import type mongoose from "mongoose";
import { env } from "../config/env";
import { Client } from "../models/client.model";
import { GoogleCalendar } from "../models/googleCalendar.model";
import { ClientService } from "../models/clientService.model";
import { Content } from "../models/content.model";
import { Lead } from "../models/lead.model";
import { Message, MessageRead } from "../models/message.model";
import { Notification } from "../models/notification.model";
import { OnboardingComment } from "../models/onboardingComment.model";
import { Project } from "../models/project.model";
import { RefreshToken } from "../models/refreshToken.model";
import { Report } from "../models/report.model";
import { User } from "../models/user.model";
import { emitToUsers } from "../realtime/messagesRealtime";
import { deleteFromSpaces } from "./uploadToSpaces";
import { deleteEvent } from "./googleCalendar";

// Everything kept for a client, removed with it: its logins, content, onboarding comments,
// messages, notifications, projects, reports, leads and services — and the files of all of
// them in Spaces. Payments (service orders) and the audit log stay: they are the record of
// what happened.

type Id = mongoose.Types.ObjectId | string;

// The models whose documents belong to one client, by their `client` field.
const OWNED = [Content, OnboardingComment, Message, MessageRead, Notification, Project, Report, Lead, ClientService] as const;

// Every file URL of ours anywhere in a document.
const filesIn = (value: unknown, found: Set<string>) => {
  if (typeof value === "string") {
    if (env.doSpaces.cdnUrl && value.startsWith(`${env.doSpaces.cdnUrl}/`)) found.add(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) filesIn(entry, found);
  } else if (value && typeof value === "object" && !(value instanceof Date) && value.constructor?.name !== "ObjectId") {
    for (const entry of Object.values(value)) filesIn(entry, found);
  }
};

// Removes the clients' records and files. The clients themselves too, when they still exist.
export const removeClientData = async (clientIds: Id[]) => {
  if (!clientIds.length) return { files: 0 };
  const filter = { client: { $in: clientIds } };
  const files = new Set<string>();

  const clients = await Client.find({ _id: { $in: clientIds } }).lean();
  for (const client of clients) filesIn(client, files);
  // Their logins: those that name the client, and the one the client names — so no way in is left.
  const loginIds = clients.flatMap((client) => (client.user ? [client.user] : []));
  const users = await User.find({ $or: [filter, { _id: { $in: loginIds }, role: "client" }] }).select("_id avatar").lean();
  const userIds = users.map((user) => user._id);
  for (const user of users) filesIn(user.avatar, files);
  for (const model of OWNED) {
    for (const doc of await (model as mongoose.Model<unknown>).find(filter).lean()) filesIn(doc, files);
  }

  await Promise.all(OWNED.map((model) => (model as mongoose.Model<unknown>).deleteMany(filter)));
  await RefreshToken.deleteMany({ user: { $in: userIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  await Client.deleteMany({ _id: { $in: clientIds } });
  // Anyone still signed in to the client portal is signed out there now.
  emitToUsers(userIds.map(String), "account:removed", {});

  // Best effort — an unreachable file store shouldn't fail the delete.
  await Promise.allSettled([...files].map((url) => deleteFromSpaces(url)));
  // Their onboarding call, booked in the portal, comes off the team's calendar too: there is no
  // one left to meet. Best effort, like the files.
  await Promise.allSettled(
    clients.map(async (client) => {
      const call = client.onboarding?.kickoffCall;
      if (!call?.eventId || !call.calendar || (call.callAt && new Date(call.callAt).getTime() < Date.now())) return;
      const account = await GoogleCalendar.findById(call.calendar).select("+refreshTokenSealed");
      if (account) await deleteEvent(account, call.eventId);
    })
  );
  return { files: files.size };
};
