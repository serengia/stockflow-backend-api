import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import * as returnsService from "../services/returns.service.js";

interface RequestWithBody {
  body?: unknown;
  query?: Record<string, unknown>;
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  saleId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return undefined;
    }),
  from: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v : undefined)),
  to: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v : undefined)),
});

const createBodySchema = z.object({
  saleId: z
    .union([z.string(), z.number()])
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return NaN;
    })
    .refine((v) => Number.isFinite(v) && v > 0, "Valid saleId is required"),
  items: z
    .array(
      z.object({
        productId: z
          .union([z.string(), z.number()])
          .transform((v) => {
            if (typeof v === "number") return v;
            if (typeof v === "string" && v.trim() !== "") return Number(v);
            return NaN;
          })
          .refine((v) => Number.isFinite(v) && v > 0, "Valid productId is required"),
        quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
      }),
    )
    .min(1, "At least one item is required"),
  reason: z.string().max(500).optional(),
  refundMethod: z.string().optional(),
  referenceCode: z.string().max(255).optional(),
  branchId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return undefined;
    }),
});

function normalizePaymentMethod(
  value: string | undefined,
): "cash" | "mpesa" | "bank_transfer" | "card" | "other" | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "cash") return "cash";
  if (v === "mpesa" || v === "m-pesa" || v === "m pesa") return "mpesa";
  if (v === "card") return "card";
  if (v === "bank" || v === "bank_transfer" || v === "bank transfer") return "bank_transfer";
  return "other";
}

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return (issue && "message" in issue ? String(issue.message) : undefined) ?? "Validation failed";
}

export const returnsRouter = new Router({
  prefix: "/returns",
});

// GET /api/v1/returns
returnsRouter.get("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const query = (ctx.request as RequestWithBody).query ?? {};
  const parsed = listQuerySchema.safeParse(query);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const { saleId, from, to } = parsed.data;

  const items = await returnsService.listReturns({
    businessId: user.businessId,
    branchId: user.branchId ?? null,
    saleId,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  });

  ctx.status = 200;
  ctx.body = { data: items };
});

// GET /api/v1/returns/:id
returnsRouter.get("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid return id", error: { message: "Invalid return id" } };
    return;
  }

  const item = await returnsService.getReturnById({
    id,
    businessId: user.businessId,
  });

  if (!item) {
    ctx.status = 404;
    ctx.body = { message: "Return not found", error: { message: "Return not found" } };
    return;
  }

  ctx.status = 200;
  ctx.body = { data: item };
});

// POST /api/v1/returns
returnsRouter.post("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const body = (ctx.request as RequestWithBody).body;
  const parsed = createBodySchema.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const payload = parsed.data;

  try {
    const created = await returnsService.createReturn({
      businessId: user.businessId,
      branchId: payload.branchId ?? (user.branchId ?? null),
      userId: user.id,
      saleId: payload.saleId,
      items: payload.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
      reason: payload.reason,
      refundMethod: normalizePaymentMethod(payload.refundMethod),
      referenceCode: payload.referenceCode ?? null,
    });

    ctx.status = 201;
    ctx.body = { data: created };
  } catch (err) {
    const anyErr = err as Error & { status?: number };
    const status = anyErr.status && anyErr.status >= 400 && anyErr.status < 600 ? anyErr.status : 500;
    ctx.status = status;
    ctx.body = {
      message: anyErr.message || "Failed to create return",
      error: { message: anyErr.message || "Failed to create return" },
    };
  }
});

