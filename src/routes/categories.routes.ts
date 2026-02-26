import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import * as categoriesService from "../services/productCategories.service.js";

interface RequestWithBody {
  body?: unknown;
}

const categoryBodySchema = z.object({
  name: z.string().min(1, "Name is required"),
});

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return (issue && "message" in issue ? String(issue.message) : undefined) ?? "Validation failed";
}

export const categoriesRouter = new Router({
  prefix: "/categories",
});

// GET /api/v1/categories
categoriesRouter.get("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;

  const items = await categoriesService.listCategories({
    businessId: user.businessId,
  });

  ctx.status = 200;
  ctx.body = { data: items };
});

// POST /api/v1/categories
categoriesRouter.post("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const body = (ctx.request as RequestWithBody).body;
  const parsed = categoryBodySchema.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const created = await categoriesService.createCategory({
    businessId: user.businessId,
    name: parsed.data.name,
  });

  ctx.status = 201;
  ctx.body = { data: created };
});

// PATCH /api/v1/categories/:id
categoriesRouter.patch("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid category id", error: { message: "Invalid category id" } };
    return;
  }

  const body = (ctx.request as RequestWithBody).body;
  const parsed = categoryBodySchema.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const updated = await categoriesService.updateCategory({
    id,
    businessId: user.businessId,
    name: parsed.data.name,
  });

  ctx.status = 200;
  ctx.body = { data: updated };
});

// DELETE /api/v1/categories/:id
categoriesRouter.delete("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid category id", error: { message: "Invalid category id" } };
    return;
  }

  await categoriesService.deleteCategory({
    id,
    businessId: user.businessId,
  });

  ctx.status = 204;
  ctx.body = null;
});

