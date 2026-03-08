import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import * as promotionsService from "../services/promotions.service.js";

interface RequestWithBody {
  body?: unknown;
  query?: Record<string, unknown>;
}

const promotionBodySchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1).default("percent_off"),
  config: z.record(z.string(), z.unknown()).optional(),
  validFrom: z.string().min(1, "Valid from is required"),
  validTo: z.string().optional(),
});

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return (issue && "message" in issue ? String(issue.message) : undefined) ?? "Validation failed";
}

export const promotionsRouter = new Router({
  prefix: "/promotions",
});

// GET /api/v1/promotions
promotionsRouter.get("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;

  const items = await promotionsService.listPromotions({
    businessId: user.businessId,
  });

  ctx.status = 200;
  ctx.body = { data: items };
});

// POST /api/v1/promotions
promotionsRouter.post("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const body = (ctx.request as RequestWithBody).body;
  const parsed = promotionBodySchema.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const payload = parsed.data;

  const created = await promotionsService.createPromotion({
    businessId: user.businessId,
    name: payload.name,
    type: payload.type,
    config: payload.config != null ? (payload.config as Record<string, unknown>) : null,
    validFrom: payload.validFrom,
    validTo: payload.validTo ?? null,
  });

  ctx.status = 201;
  ctx.body = { data: [created] };
});

// PATCH /api/v1/promotions/:id
promotionsRouter.patch("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);

  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid promotion id", error: { message: "Invalid promotion id" } };
    return;
  }

  const body = (ctx.request as RequestWithBody).body;
  const parsed = promotionBodySchema.partial().safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const payload = parsed.data;

  const updated = await promotionsService.updatePromotion({
    id,
    businessId: user.businessId,
    ...(payload.name !== undefined && { name: payload.name }),
    ...(payload.type !== undefined && { type: payload.type }),
    ...(payload.config !== undefined && {
      config: payload.config as Record<string, unknown>,
    }),
    ...(payload.validFrom !== undefined && { validFrom: payload.validFrom }),
    ...(payload.validTo !== undefined && { validTo: payload.validTo }),
  });

  ctx.status = 200;
  ctx.body = { data: updated };
});

// DELETE /api/v1/promotions/:id
promotionsRouter.delete("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);

  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid promotion id", error: { message: "Invalid promotion id" } };
    return;
  }

  await promotionsService.deletePromotion({
    id,
    businessId: user.businessId,
  });

  ctx.status = 204;
  ctx.body = null;
});
