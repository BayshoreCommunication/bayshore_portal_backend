import mongoose from "mongoose";
import { env } from "./env";

let connectionPromise: Promise<typeof mongoose> | null = null;

export const connectDB = async (): Promise<string> => {
  mongoose.set("strictQuery", true);

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection.host;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });
  }

  let conn: typeof mongoose;

  try {
    conn = await connectionPromise;
    connectionPromise = null;
  } catch (error) {
    connectionPromise = null;
    throw error;
  }

  return conn.connection.host;
};
