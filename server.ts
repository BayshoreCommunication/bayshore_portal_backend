import app from "./app";
import { env } from "./config/env";
import { connectDB } from "./config/db";
import { createServer } from "http";
import { initializeMessagesRealtime } from "./realtime/messagesRealtime";

const start = async () => {
  try {
    const dbHost = await connectDB();

    const server = createServer(app);
    initializeMessagesRealtime(server);
    server.listen(env.port, () => {
      const baseUrl = `http://localhost:${env.port}`;
      const divider = "-".repeat(50);

      console.log(divider);
      console.log(`  Environment    ${env.nodeEnv}`);
      console.log(`  Database       connected (${dbHost})`);
      console.log(`  Port           ${env.port}`);
      console.log(`  Local          ${baseUrl}`);
      console.log(`  API Base       ${baseUrl}/api/v1`);
      console.log(`  API Docs       ${baseUrl}/api-docs`);
      console.log(`  Health Check   ${baseUrl}/api/v1/health`);
      console.log(divider);
    });

    process.on("unhandledRejection", (err: Error) => {
      console.error("Unhandled Rejection:", err);
      server.close(() => process.exit(1));
    });
  } catch (err) {
    console.error(`Failed to start server: ${(err as Error).message}`);
    process.exit(1);
  }
};

start();
