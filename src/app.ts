import path from "path";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import cors from "@koa/cors";
import helmet from "koa-helmet";
import compress from "koa-compress";
import koaPinoLogger from "koa-pino-logger";
import Router from "@koa/router";
// @ts-expect-error koa-ejs has no types
import render from "koa-ejs";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestId } from "./middleware/requestId.js";
import { authRouter } from "./routes/auth.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { uploadsRouter } from "./routes/uploads.routes.js";
import { productsRouter } from "./routes/products.routes.js";
import { categoriesRouter } from "./routes/categories.routes.js";
import { skusRouter } from "./routes/skus.routes.js";
import { salesRouter } from "./routes/sales.routes.js";

export function createApp() {
  const app = new Koa();

  // EJS views (project root views/; email templates in views/emails with partials)
  render(app, {
    root: path.join(process.cwd(), "views"),
    layout: false,
    viewExt: "ejs",
    cache: env.nodeEnv === "production",
  });

  app.use(errorHandler);
  app.use(requestId);

  app.use(
    koaPinoLogger({
      level: env.nodeEnv === "production" ? "info" : "debug",
      redact: ["req.headers.authorization"],
      autoLogging: true,
      ...(env.nodeEnv === "development"
        ? {
            // Pretty, colored output in development (similar to morgan)
            transport: {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "HH:MM:ss",
                singleLine: true,
                messageFormat:
                  "{req.method} {req.url} {res.statusCode} - {responseTime}ms",
              },
            },
          }
        : {}),
    }),
  );

  app.use(
    cors({
      origin: (ctx) => ctx.request.get("Origin") ?? "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      credentials: true,
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
  router.use(authRouter.routes()).use(authRouter.allowedMethods());
  router.use(productsRouter.routes()).use(productsRouter.allowedMethods());
  router.use(categoriesRouter.routes()).use(categoriesRouter.allowedMethods());
  router.use(skusRouter.routes()).use(skusRouter.allowedMethods());
  router.use(salesRouter.routes()).use(salesRouter.allowedMethods());
  router.use(uploadsRouter.routes()).use(uploadsRouter.allowedMethods());

  app.use(router.routes()).use(router.allowedMethods());

  return app;
}
