import Koa from "koa";
import bodyParser from "koa-bodyparser";
import cors from "@koa/cors";
import helmet from "koa-helmet";
import compress from "koa-compress";
import koaPinoLogger from "koa-pino-logger";
import Router from "@koa/router";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestId } from "./middleware/requestId.js";
import { healthRouter } from "./routes/health.routes.js";

export function createApp() {
  const app = new Koa();

  app.use(errorHandler);
  app.use(requestId);

  app.use(
    koaPinoLogger({
      level: env.nodeEnv === "production" ? "info" : "debug",
      redact: ["req.headers.authorization"],
      autoLogging: true,
    }),
  );

  app.use(
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  app.use(
    compress({
      threshold: 2048,
    }),
  );

  app.use(
    bodyParser({
      enableTypes: ["json", "form"],
    }),
  );

  const router = new Router({ prefix: "/api/v1" });
  router.use(healthRouter.routes()).use(healthRouter.allowedMethods());

  app.use(router.routes()).use(router.allowedMethods());

  return app;
}
