import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { Client } from "../models/client.model";
import { ClientService } from "../models/clientService.model";
import { Content } from "../models/content.model";
import { Lead } from "../models/lead.model";
import { Message, MessageRead } from "../models/message.model";
import { Notification } from "../models/notification.model";
import { OnboardingComment } from "../models/onboardingComment.model";
import { Project } from "../models/project.model";
import { Report } from "../models/report.model";
import { User } from "../models/user.model";
import { removeClientData } from "../utils/clientCleanup";

// One-off: removes what is left of clients deleted before their data went with them.
// `--dry` only says what it would remove.
const run = async () => {
  const dry = process.argv.includes("--dry");
  await connectDB();
  const existing = new Set((await Client.find().distinct("_id")).map(String));
  const models = { Content, OnboardingComment, Message, MessageRead, Notification, Project, Report, Lead, ClientService, User };
  const gone = new Set<string>();
  for (const [name, model] of Object.entries(models)) {
    const ids = ((await (model as mongoose.Model<unknown>).distinct("client")) as unknown[]).filter(Boolean).map(String).filter((id) => !existing.has(id));
    const count = ids.length ? await (model as mongoose.Model<unknown>).countDocuments({ client: { $in: ids } }) : 0;
    if (count) console.log(`${name}: ${count}`);
    ids.forEach((id) => gone.add(id));
  }
  console.log(`Deleted clients with data left: ${gone.size}`);
  if (!dry && gone.size) console.log("Removed — files:", (await removeClientData([...gone])).files);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
