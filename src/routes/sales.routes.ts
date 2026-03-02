import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import { createSale, listSales } from "../services/sales.service.js";

interface RequestWithBody {
  body?: unknown;
}

const saleItemSchema = z.object({
  productId: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : Number(v))),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().min(0),
});

const createSaleSchema = z.object({
  items: z.array(saleItemSchema).min(1),
  subtotal: z.coerce.number().optional(),
  vatAmount: z.coerce.number().optional(),
  discountAmount: z.coerce.number().optional(),
  totalAmount: z.coerce.number().optional(),
  discountType: z.string().optional(),
  promoCode: z.string().optional(),
  paymentMethod: z.string().min(1),
  referenceCode: z.string().optional(),
  branchId: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return undefined;
    }),
  offlineId: z.string().optional(),
});

const listQuerySchema = z.object({
  from: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
  to: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
  branchId: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return undefined;
    }),
});

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return (
    (issue && "message" in issue ? String(issue.message) : undefined) ??
    "Validation failed"
  );
}

function mapPaymentMethod(value: string): "cash" | "mpesa" | "bank_transfer" | "card" | "other" {
  const v = value.trim().toLowerCase();
  if (v === "cash") return "cash";
  if (v === "mpesa" || v === "m-pesa" || v === "m pesa") return "mpesa";
  if (v === "card") return "card";
  if (v === "bank" || v === "bank_transfer" || v === "bank transfer") return "bank_transfer";
  return "other";
}

export const salesRouter = new Router({
  prefix: "/sales",
});

salesRouter.get("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const query = (ctx.request as RequestWithBody).query ?? {};
  const parsed = listQuerySchema.safeParse(query);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const { from, to, branchId: branchIdFromQuery } = parsed.data;

  const branchId =
    typeof branchIdFromQuery === "number"
      ? branchIdFromQuery
      : user.branchId != null
      ? user.branchId
      : undefined;

  let fromDate: Date | undefined;
  let toDate: Date | undefined;

  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) {
      fromDate = d;
    }
  }

  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      // Include the entire "to" day by moving to the end of the day
      d.setHours(23, 59, 59, 999);
      toDate = d;
    }
  }

  const items = await listSales({
    businessId: user.businessId,
    branchId: branchId ?? null,
    from: fromDate,
    to: toDate,
  });

  ctx.status = 200;
  ctx.body = { data: items };
});

salesRouter.post("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const body = (ctx.request as RequestWithBody).body;
  const parsed = createSaleSchema.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const data = parsed.data;

  const branchId =
    typeof data.branchId === "number"
      ? data.branchId
      : user.branchId != null
      ? user.branchId
      : undefined;

  if (!branchId) {
    ctx.status = 400;
    ctx.body = {
      message: "Branch is required for a sale",
      error: { message: "Branch is required for a sale" },
    };
    return;
  }

  const computedTotal =
    typeof data.totalAmount === "number" && data.totalAmount > 0
      ? data.totalAmount
      : data.items.reduce(
          (sum, item) => sum + item.quantity * item.unitPrice,
          0,
        );

  try {
    const created = await createSale({
      businessId: user.businessId,
      branchId,
      userId: user.id,
      items: data.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      totalAmount: computedTotal,
      paymentMethod: mapPaymentMethod(data.paymentMethod),
      referenceCode: data.referenceCode ?? null,
      offlineId: data.offlineId ?? null,
    });

    ctx.status = 201;
    ctx.body = {
      data: {
        id: created.id,
        totalAmount: created.totalAmount,
        date: created.soldAt,
      },
    };
  } catch (error) {
    const err = error as Error & { status?: number };
    const status = typeof err.status === "number" ? err.status : 500;
    ctx.status = status;
    ctx.body = {
      message: err.message || "Failed to create sale",
      error: { message: err.message || "Failed to create sale" },
    };
  }
});

