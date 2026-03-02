import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import * as stockTransfersService from "../services/stock-transfers.service.js";

interface RequestWithBody {
  body?: unknown;
  query?: Record<string, unknown>;
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  branchId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return undefined;
    }),
});

const createBodySchema = z.object({
  fromBranchId: z
    .union([z.string(), z.number()])
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return NaN;
    })
    .refine((v) => Number.isFinite(v) && v > 0, "Valid fromBranchId is required"),
  toBranchId: z
    .union([z.string(), z.number()])
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return NaN;
    })
    .refine((v) => Number.isFinite(v) && v > 0, "Valid toBranchId is required"),
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
});

const updateBodySchema = z.object({
  status: z.enum(["pending", "in-transit", "received"]),
});

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return (issue && "message" in issue ? String(issue.message) : undefined) ?? "Validation failed";
}

export const stockTransfersRouter = new Router({
  prefix: "/stock-transfers",
});

// GET /api/v1/stock-transfers
stockTransfersRouter.get("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const query = (ctx.request as RequestWithBody).query ?? {};
  const parsed = listQuerySchema.safeParse(query);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const { branchId: branchIdFromQuery } = parsed.data;

  const branchId =
    typeof branchIdFromQuery === "number"
      ? branchIdFromQuery
      : user.branchId != null
      ? user.branchId
      : undefined;

  const items = await stockTransfersService.listStockTransfers({
    businessId: user.businessId,
    branchId: branchId ?? null,
  });

  ctx.status = 200;
  ctx.body = { data: items };
});

// GET /api/v1/stock-transfers/:id
stockTransfersRouter.get("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid stock transfer id", error: { message: "Invalid stock transfer id" } };
    return;
  }

  const item = await stockTransfersService.getStockTransferById({
    id,
    businessId: user.businessId,
  });

  if (!item) {
    ctx.status = 404;
    ctx.body = { message: "Stock transfer not found", error: { message: "Stock transfer not found" } };
    return;
  }

  ctx.status = 200;
  ctx.body = { data: item };
});

// POST /api/v1/stock-transfers
stockTransfersRouter.post("/", requireAuth, async (ctx: Context) => {
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
    const created = await stockTransfersService.createStockTransfer({
      businessId: user.businessId,
      userId: user.id,
      fromBranchId: payload.fromBranchId,
      toBranchId: payload.toBranchId,
      items: payload.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
    });

    ctx.status = 201;
    ctx.body = { data: created };
  } catch (err) {
    const anyErr = err as Error & { status?: number };
    const status = anyErr.status && anyErr.status >= 400 && anyErr.status < 600 ? anyErr.status : 500;
    ctx.status = status;
    ctx.body = {
      message: anyErr.message || "Failed to create stock transfer",
      error: { message: anyErr.message || "Failed to create stock transfer" },
    };
  }
});

// PATCH /api/v1/stock-transfers/:id
stockTransfersRouter.patch("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid stock transfer id", error: { message: "Invalid stock transfer id" } };
    return;
  }

  const body = (ctx.request as RequestWithBody).body;
  const parsed = updateBodySchema.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const payload = parsed.data;

  try {
    const updated = await stockTransfersService.updateStockTransferStatus({
      id,
      businessId: user.businessId,
      status: payload.status,
    });

    ctx.status = 200;
    ctx.body = { data: updated };
  } catch (err) {
    const anyErr = err as Error & { status?: number };
    const status = anyErr.status && anyErr.status >= 400 && anyErr.status < 600 ? anyErr.status : 500;
    ctx.status = status;
    ctx.body = {
      message: anyErr.message || "Failed to update stock transfer",
      error: { message: anyErr.message || "Failed to update stock transfer" },
    };
  }
});

