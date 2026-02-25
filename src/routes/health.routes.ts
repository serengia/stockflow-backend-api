import Router from "@koa/router";
import type Koa from "koa";

export const healthRouter = new Router();

healthRouter.get("/health", async (ctx: Koa.Context) => {
  ctx.status = 200;
  ctx.body = {
    status: "ok",
  };
});

healthRouter.get("/ready", async (ctx: Koa.Context) => {
  ctx.status = 200;
  ctx.body = {
    status: "ready",
    dependencies: {
      database: "unknown",
      redis: "unknown",
    },
  };
});

