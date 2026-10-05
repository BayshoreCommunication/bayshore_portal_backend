import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { Service } from "../models/service.model";

// The four services the Services page showed as samples before the catalog had a
// backend. Adds the ones the catalog doesn't have yet (matched by name) and leaves
// everything else alone, so it's safe to run more than once.
const STARTING_SERVICES = [
  {
    title: "SEO & Website Optimization",
    plan: "growth",
    color: "#c8973a",
    description: "Ongoing organic search strategy to keep you ranking for high-intent local search terms.",
    subServices: [
      { name: "Monthly keyword rank tracking & reporting", price: 250 },
      { name: "On-page & technical SEO fixes", price: 300 },
      { name: "Backlink outreach (4–6 placements/mo)", price: 300 },
      { name: "Quarterly content strategy review", price: 150 },
      { name: "Local citation building", price: 100 },
      { name: "Competitor gap analysis", price: 100 },
    ],
  },
  {
    title: "Google Business Profile Management",
    plan: "core",
    color: "#2f8f6f",
    description: "Keeps your GMB listing active, accurate, and responsive so it keeps converting map-pack traffic.",
    subServices: [
      { name: "Weekly posts & photo updates", price: 150 },
      { name: "Review monitoring & response", price: 150 },
      { name: "Q&A section management", price: 150 },
      { name: "Monthly map-pack ranking snapshot", price: 150 },
      { name: "GMB post scheduling automation", price: 50 },
      { name: "Duplicate listing cleanup", price: 50 },
    ],
  },
  {
    title: "Social Media Management",
    plan: "growth",
    color: "#3457c9",
    description: "Content, community management, and light paid boosting across Facebook & Instagram.",
    subServices: [
      { name: "12 posts/month across Facebook & Instagram", price: 300 },
      { name: "Comment & DM monitoring", price: 150 },
      { name: "Monthly content calendar for your approval", price: 150 },
      { name: "Paid boost on top posts", price: 200 },
      { name: "Instagram Reels production", price: 100 },
      { name: "Influencer outreach coordination", price: 100 },
    ],
  },
  {
    title: "Website Care & Hosting",
    plan: "core",
    color: "#0b1522",
    description: "Keeps your site fast, secure, and online — hosting, backups, and routine maintenance.",
    subServices: [
      { name: "Hosting, SSL & uptime monitoring", price: 200 },
      { name: "Monthly plugin & security updates", price: 150 },
      { name: "Site speed checks", price: 100 },
      { name: "Same-business-day emergency fixes", price: 100 },
      { name: "Monthly backup verification", price: 25 },
      { name: "Uptime SLA reporting", price: 25 },
    ],
  },
];

const run = async () => {
  await connectDB();

  for (const service of STARTING_SERVICES) {
    const existing = await Service.exists({ titleKey: service.title.toLowerCase() });
    if (existing) {
      console.log(`Already in the catalog: ${service.title}`);
      continue;
    }
    const created = await Service.create(service);
    console.log(`Added: ${created.title} ($${created.monthlyPrice}/mo, ${created.subServices.length} sub-services)`);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
