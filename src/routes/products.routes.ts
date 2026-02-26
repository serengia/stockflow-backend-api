import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import * as productsService from "../services/products.service.js";

interface RequestWithBody {
  body?: unknown;
  query?: Record<string, unknown>;
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().optional(),
  belowReorder: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return v.toLowerCase() === "true";
      return false;
    }),
  branchId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return undefined;
    })
    .optional(),
});

const productBodySchema = z.object({
  name: z.string().min(1, "Name is required"),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  category: z.string().optional(),
  costPrice: z.coerce.number().min(0),
  sellPrice: z.coerce.number().min(0),
  quantity: z.coerce.number().int().min(0).optional(),
  reorderLevel: z.coerce.number().int().min(0).optional(),
  imageUrl: z.string().url().optional(),
});

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return (issue && "message" in issue ? String(issue.message) : undefined) ?? "Validation failed";
}

export const productsRouter = new Router({
  prefix: "/products",
});

// GET /api/v1/products
productsRouter.get("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const query = (ctx.request as RequestWithBody).query ?? {};
  const parsed = listQuerySchema.safeParse(query);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const { belowReorder, branchId: branchIdFromQuery } = parsed.data;

  const branchId =
    typeof branchIdFromQuery === "number"
      ? branchIdFromQuery
      : user.branchId != null
      ? user.branchId
      : undefined;

  const items = await productsService.listProducts({
    businessId: user.businessId,
    branchId,
  });

  const data = belowReorder ? items.filter((p) => p.quantity < p.reorderLevel) : items;

  ctx.status = 200;
  ctx.body = { data };
});

// POST /api/v1/products
productsRouter.post("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const body = (ctx.request as RequestWithBody).body;
  const parsed = productBodySchema.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const payload = parsed.data;

  const created = await productsService.createProduct({
    businessId: user.businessId,
    branchId: user.branchId ?? undefined,
    userId: user.id,
    name: payload.name,
    sku: payload.sku,
    category: payload.category,
    costPrice: payload.costPrice,
    sellPrice: payload.sellPrice,
    quantity: payload.quantity,
    reorderLevel: payload.reorderLevel,
  });

  ctx.status = 201;
  ctx.body = { data: created };
});

// PATCH /api/v1/products/:id
productsRouter.patch("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid product id", error: { message: "Invalid product id" } };
    return;
  }

  const body = (ctx.request as RequestWithBody).body;
  const parsed = productBodySchema.partial().safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const payload = parsed.data;

  const updated = await productsService.updateProduct({
    id,
    businessId: user.businessId,
    branchId: user.branchId ?? undefined,
    userId: user.id,
    name: payload.name,
    sku: payload.sku,
    category: payload.category,
    costPrice: payload.costPrice,
    sellPrice: payload.sellPrice,
    quantity: payload.quantity,
    reorderLevel: payload.reorderLevel,
  });

  ctx.status = 200;
  ctx.body = { data: updated };
});

// DELETE /api/v1/products/:id
productsRouter.delete("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid product id", error: { message: "Invalid product id" } };
    return;
  }

  await productsService.deleteProduct({
    id,
    businessId: user.businessId,
  });

  ctx.status = 204;
  ctx.body = null;
});

