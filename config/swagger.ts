import path from "path";
import swaggerJsdoc from "swagger-jsdoc";
import { env } from "./env";

const ext = __filename.endsWith(".ts") ? "ts" : "js";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Bayshore Client-Portal API",
      version: "1.0.0",
      description: "REST API documentation for the Bayshore Client-Portal backend",
    },
    servers: [
      {
        url: `${env.publicUrl}/api/v1`,
        description: `${env.nodeEnv} server`,
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: [
    path.join(__dirname, `../routes/*.${ext}`),
    path.join(__dirname, `../models/*.${ext}`),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
