import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { User } from "../models/user.model";

const run = async () => {
  const {
    SUPERADMIN_FULL_NAME,
    SUPERADMIN_EMAIL,
    SUPERADMIN_PASSWORD,
  } = process.env;

  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
    console.error(
      "Missing SUPERADMIN_EMAIL or SUPERADMIN_PASSWORD in .env. Set them before running the seed script."
    );
    process.exit(1);
  }

  await connectDB();

  const existing = await User.findOne({ role: "superadmin" });
  if (existing) {
    console.log(
      `A superadmin already exists (${existing.email || existing.phone}). Skipping.`
    );
    await mongoose.disconnect();
    return;
  }

  const superadmin = await User.create({
    fullName: SUPERADMIN_FULL_NAME || "Super Admin",
    email: SUPERADMIN_EMAIL,
    password: SUPERADMIN_PASSWORD,
    role: "superadmin",
  });

  console.log(`Superadmin created: ${superadmin.email}`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
