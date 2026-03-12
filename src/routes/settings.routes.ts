import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import { db } from "../db/index.js";
import { businesses } from "../db/schema/schema.js";

export const settingsRouter = new Router({ prefix: "/settings" });

const businessTypeSchema = z.object({
  businessType: z.string().min(1, "Business type is required"),
});

settingsRouter.get("/business-type", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;

  const [biz] = await db
    .select({ industry: businesses.industry })
    .from(businesses)
    .where(eq(businesses.id, user.businessId))
    .limit(1);

  ctx.status = 200;
  ctx.body = { data: { businessType: biz?.industry ?? "" } };
});

settingsRouter.patch("/business-type", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;

  if (user.role !== "admin" && user.role !== "manager") {
    ctx.status = 403;
    ctx.body = { error: "Only admins and managers can update business type" };
    return;
  }

  const body = (ctx.request as unknown as { body?: unknown }).body;
  const parsed = businessTypeSchema.safeParse(body);
  if (!parsed.success) {
    ctx.status = 400;
    ctx.body = { error: parsed.error.flatten().fieldErrors };
    return;
  }

  await db
    .update(businesses)
    .set({ industry: parsed.data.businessType })
    .where(eq(businesses.id, user.businessId));

  ctx.status = 200;
  ctx.body = { data: { businessType: parsed.data.businessType } };
});
