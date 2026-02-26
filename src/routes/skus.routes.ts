import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import * as skusService from "../services/productSkus.service.js";

interface RequestWithBody {
  body?: unknown;
}

const skuBodySchema = z.object({
  code: z.string().min(1, "Code is required"),
  reorderLevel: z.coerce.number().int().min(0).optional(),
});

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return (issue && "message" in issue ? String(issue.message) : undefined) ?? "Validation failed";
}

export const skusRouter = new Router({
  prefix: "/skus",
});

// GET /api/v1/skus
skusRouter.get("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;

  const items = await skusService.listSkus({
    businessId: user.businessId,
  });

  ctx.status = 200;
  ctx.body = { data: items };
});

// POST /api/v1/skus
skusRouter.post("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const body = (ctx.request as RequestWithBody).body;
  const parsed = skuBodySchema.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const created = await skusService.createSku({
    businessId: user.businessId,
    code: parsed.data.code,
    reorderLevel: parsed.data.reorderLevel,
  });

  ctx.status = 201;
  ctx.body = { data: created };
});

// PATCH /api/v1/skus/:id
skusRouter.patch("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid SKU id", error: { message: "Invalid SKU id" } };
    return;
  }

  const body = (ctx.request as RequestWithBody).body;
  const parsed = skuBodySchema.partial().safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const updated = await skusService.updateSku({
    id,
    businessId: user.businessId,
    code: parsed.data.code,
    reorderLevel: parsed.data.reorderLevel,
  });

  ctx.status = 200;
  ctx.body = { data: updated };
});

// DELETE /api/v1/skus/:id
skusRouter.delete("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid SKU id", error: { message: "Invalid SKU id" } };
    return;
  }

  await skusService.deleteSku({
    id,
    businessId: user.businessId,
  });

  ctx.status = 204;
  ctx.body = null;
});

