import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { connectDB } from "./config/db";
import { swaggerSpec } from "./config/swagger";
import routes from "./routes/index";
import { notFound } from "./middleware/notFound";
import { errorHandler } from "./middleware/errorHandler";
import { requestContext } from "./middleware/requestContext";
import { stripeWebhook } from "./controllers/payment.controller";

const app = express();
const swaggerUiVersion = "5.32.13";
const serializedSwaggerSpec = JSON.stringify(swaggerSpec).replace(/</g, "\\u003c");
const swaggerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Bayshore Client-Portal API Documentation</title>
    <link rel="icon" href="data:," />
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${swaggerUiVersion}/swagger-ui.css"
    />
    <style>
      html { box-sizing: border-box; overflow-y: scroll; }
      *, *::before, *::after { box-sizing: inherit; }
      body { margin: 0; background: #fafafa; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${swaggerUiVersion}/swagger-ui-bundle.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${swaggerUiVersion}/swagger-ui-standalone-preset.js" crossorigin="anonymous"></script>
    <script>
      window.addEventListener("load", function () {
        window.ui = SwaggerUIBundle({
          spec: ${serializedSwaggerSpec},
          dom_id: "#swagger-ui",
          deepLinking: true,
          persistAuthorization: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          plugins: [SwaggerUIBundle.plugins.DownloadUrl],
          layout: "StandaloneLayout"
        });
      });
    </script>
  </body>
</html>`;

// Keep the root and common docs aliases friendly on local Node and Vercel.
app.get("/", (_req, res) => res.redirect(302, "/api-docs"));
app.get(["/api/docs", "/docs"], (_req, res) =>
  res.redirect(302, "/api-docs")
);

// Keep docs independent from serverless static-file bundling on Vercel.
app.get(["/api-docs", "/api-docs/"], (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("html").send(swaggerHtml);
});
app.get("/api-docs.json", (_req, res) => res.json(swaggerSpec));

app.use(helmet());
app.use(
  cors({
    origin: env.isProduction ? env.clientUrls : true,
    credentials: true,
  })
);
// Stripe signs the exact bytes it sends, so its webhook takes the body raw —
// this has to sit ahead of express.json(), which would parse (and so change) it.
app.post("/api/v1/payments/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhook);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (!env.isProduction) {
  app.use(morgan("dev"));
}

app.use("/api/v1", requestContext);
app.use("/api/v1", async (_req, _res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    next(error);
  }
});
app.use("/api/v1", routes);

app.use(notFound);
app.use(errorHandler);

export default app;
