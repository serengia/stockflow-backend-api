import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import * as suppliersService from "../services/suppliers.service.js";

interface RequestWithBody {
  body?: unknown;
  query?: Record<string, unknown>;
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const supplierBodySchema = z.object({
  name: z.string().min(1, "Name is required"),
  contact: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return (issue && "message" in issue ? String(issue.message) : undefined) ?? "Validation failed";
}

export const suppliersRouter = new Router({
  prefix: "/suppliers",
});

// GET /api/v1/suppliers
suppliersRouter.get("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const query = (ctx.request as RequestWithBody).query ?? {};
  const parsed = listQuerySchema.safeParse(query);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const items = await suppliersService.listSuppliers({
    businessId: user.businessId,
  });

  ctx.status = 200;
  ctx.body = { data: items };
});

// POST /api/v1/suppliers
suppliersRouter.post("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const body = (ctx.request as RequestWithBody).body;
  const parsed = supplierBodySchema.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const payload = parsed.data;

  const params: Parameters<typeof suppliersService.createSupplier>[0] = {
    businessId: user.businessId,
    name: payload.name,
  };

  if (payload.contact !== undefined) {
    params.contact = payload.contact;
  }
  if (payload.email !== undefined) {
    params.email = payload.email;
  }
  if (payload.phone !== undefined) {
    params.phone = payload.phone;
  }

  const created = await suppliersService.createSupplier(params);

  ctx.status = 201;
  ctx.body = { data: created };
});

// PATCH /api/v1/suppliers/:id
suppliersRouter.patch("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);

  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid supplier id", error: { message: "Invalid supplier id" } };
    return;
  }

  const body = (ctx.request as RequestWithBody).body;
  const parsed = supplierBodySchema.partial().safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const payload = parsed.data;

  const params: Parameters<typeof suppliersService.updateSupplier>[0] = {
    id,
    businessId: user.businessId,
  };

  if (payload.name !== undefined) {
    params.name = payload.name;
  }
  if (payload.contact !== undefined) {
    params.contact = payload.contact;
  }
  if (payload.email !== undefined) {
    params.email = payload.email;
  }
  if (payload.phone !== undefined) {
    params.phone = payload.phone;
  }

  const updated = await suppliersService.updateSupplier(params);

  ctx.status = 200;
  ctx.body = { data: updated };
});

// DELETE /api/v1/suppliers/:id
suppliersRouter.delete("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);

  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid supplier id", error: { message: "Invalid supplier id" } };
    return;
  }

  await suppliersService.deleteSupplier({
    id,
    businessId: user.businessId,
  });

  ctx.status = 204;
  ctx.body = null;
});

