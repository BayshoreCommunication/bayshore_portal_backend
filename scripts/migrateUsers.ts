import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { User } from "../models/user.model";

// One-off: converts users saved with the old schema (firstName/lastName,
// isActive, customer role, structured address) to the current one. Safe to
// re-run — only documents that still lack `fullName` are touched.
const run = async () => {
  await connectDB();
  const users = User.collection;

  const legacy = await users.countDocuments({ fullName: { $exists: false } });

  if (legacy > 0) {
    await users.updateMany({ fullName: { $exists: false } }, [
      {
        $set: {
          fullName: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ["$firstName", ""] },
                  " ",
                  { $ifNull: ["$lastName", ""] },
                ],
              },
            },
          },
          status: { $cond: [{ $eq: ["$isActive", false] }, "inactive", "active"] },
          address: {
            $cond: [
              { $eq: [{ $type: "$address" }, "object"] },
              {
                $reduce: {
                  input: {
                    $filter: {
                      input: [
                        "$address.area",
                        "$address.upazila",
                        "$address.district",
                        "$address.division",
                      ],
                      cond: { $and: [{ $ne: ["$$this", null] }, { $ne: ["$$this", ""] }] },
                    },
                  },
                  initialValue: "",
                  in: {
                    $cond: [
                      { $eq: ["$$value", ""] },
                      "$$this",
                      { $concat: ["$$value", ", ", "$$this"] },
                    ],
                  },
                },
              },
              { $ifNull: ["$address", ""] },
            ],
          },
          muted: false,
          theme: "dark",
          responsibilities: "",
        },
      },
      {
        $unset: [
          "firstName",
          "lastName",
          "isActive",
          "shipToDifferentAddress",
          "shippingAddress",
        ],
      },
    ]);
  }

  const roles = await users.updateMany({ role: "customer" }, { $set: { role: "client" } });

  console.log(
    `Migrated ${legacy} user(s) to the new schema, renamed ${roles.modifiedCount} customer role(s) to client.`
  );
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
