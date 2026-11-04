import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { Client } from "../models/client.model";
import { Project } from "../models/project.model";
import { giveProjectIds } from "../utils/clientServicePlans";

// One-off: projects used to be records of their own; now a client's projects are their custom
// services (controllers/project.controller.ts). Each old project becomes a custom service on its
// client — keeping its id, so links to it still open — or fills in the one already linked to it
// or named like it. Every custom service gets its project id. `--dry` only says what it would do;
// `--delete` also removes the old project records once moved.
const run = async () => {
  const dry = process.argv.includes("--dry");
  const remove = process.argv.includes("--delete");
  await connectDB();

  const projects = await Project.find().lean();
  let moved = 0;
  for (const project of projects) {
    const client = await Client.findById(project.client);
    if (!client) {
      console.log(`Skipped "${project.name}": its client is gone`);
      continue;
    }
    const services = client.details?.services ?? [];
    const key = project.name.trim().toLowerCase();
    const existing =
      services.find((plan) => plan.custom && String(plan.project) === String(project._id)) ??
      services.find((plan) => plan.custom && !plan.project && plan.name.trim().toLowerCase() === key);
    const projectSide = {
      project: project._id,
      stage: project.status === "in_progress" ? ("in_progress" as const) : ("new" as const),
      priority: project.priority,
      files: project.files,
      requestedBy: project.requestedBy,
      createdBy: project.createdBy,
      startedAt: project.startedAt,
    };
    console.log(`${client.companyName}: "${project.name}" → ${existing ? "its custom service" : "a new custom service"}`);
    moved += 1;
    if (dry) continue;

    if (existing) {
      Object.assign(existing, projectSide);
      if (project.status === "completed" && existing.status !== "done") {
        existing.status = "done";
        existing.doneAt = project.completedAt ?? new Date();
      }
    } else {
      if (!client.details) client.set("details", {});
      client.set("details.services", [
        ...services,
        {
          name: services.some((plan) => plan.name.trim().toLowerCase() === key) ? `${project.name} (project)` : project.name,
          fields: [],
          monthly: 0,
          oneTime: 0,
          included: (project.description ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 30).map((line) => line.slice(0, 300)),
          addons: [],
          custom: true,
          deadline: project.targetDate ? new Date(project.targetDate).toISOString().slice(0, 10) : undefined,
          addedAt: project.createdAt,
          ...(project.status === "completed" ? { status: "done", doneAt: project.completedAt ?? project.updatedAt } : {}),
          ...projectSide,
        },
      ]);
    }
    client.markModified("details.services");
    await client.save();
  }

  // Custom services without their project id yet.
  let given = 0;
  for (const client of await Client.find({ "details.services": { $elemMatch: { custom: true, project: { $exists: false } } } })) {
    given += 1;
    if (!dry && giveProjectIds(client)) await client.save();
  }

  if (!dry && remove && moved) await Project.deleteMany({ _id: { $in: projects.map((project) => project._id) } });
  console.log(`${dry ? "Would move" : "Moved"} ${moved} project(s); ${given} client(s) had custom services given ids.${remove && !dry ? " Old project records deleted." : ""}`);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
