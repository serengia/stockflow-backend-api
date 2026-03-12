import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import { createSale, listSales } from "../services/sales.service.js";

interface RequestWithBody {
  body?: unknown;
  query?: Record<string, unknown>;
}

const saleItemSchema = z.object({
  productId: z.preprocess(
    (raw) => {
      if (typeof raw === "number") {
        return Number.isInteger(raw) && raw > 0 ? raw : undefined;
      }
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed === "") return undefined;
        const n = Number(trimmed);
        return Number.isInteger(n) && n > 0 ? n : undefined;
      }
      return undefined;
    },
    z.number().int().positive({ message: "Invalid product id" }),
  ),
  quantity: z.coerce.number().min(0.001),
  unitPrice: z.coerce.number().min(0),
});

const paymentSplitSchema = z.object({
  paymentMethod: z.string().min(1),
  amount: z.coerce.number().min(0),
  referenceCode: z.string().optional(),
});

const createSaleSchema = z.object({
  items: z.array(saleItemSchema).min(1),
  subtotal: z.coerce.number().optional(),
  vatAmount: z.coerce.number().optional(),
  discountAmount: z.coerce.number().optional(),
  totalAmount: z.coerce.number().optional(),
  discountType: z.string().optional(),
  promoCode: z.string().optional(),
  paymentMethod: z.string().min(1).optional(),
  payments: z.array(paymentSplitSchema).optional(),
  referenceCode: z.string().optional(),
  customerName: z.string().optional(),
  branchId: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") {
        return Number.isNaN(v) || v <= 0 ? undefined : v;
      }
      if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        return Number.isNaN(n) || n <= 0 ? undefined : n;
      }
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
  if (v === "credit" || v === "on credit") return "other";
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
  const params: Parameters<typeof listSales>[0] = {
    businessId: user.businessId,
    branchId: branchId ?? null,
  };

  if (fromDate) {
    params.from = fromDate;
  }

  if (toDate) {
    params.to = toDate;
  }

  const items = await listSales(params);

  ctx.status = 200;
  ctx.body = { data: items };
});

salesRouter.post("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const body = (ctx.request as RequestWithBody).body;
  const parsed = createSaleSchema.safeParse(body);

  if (!parsed.success) {
    // TEMP DEBUG: log validation issues for create sale (remove after debugging)
    // Location to remove later: backend-api-new/src/routes/sales.routes.ts (around validation failure branch).
    console.error("[sales:create] validation failed", {
      issues: parsed.error.issues,
      body,
    });
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
    // TEMP DEBUG: log missing branch information for create sale (remove after debugging)
    // Location to remove later: backend-api-new/src/routes/sales.routes.ts (branch guard).
    console.error("[sales:create] missing branchId", {
      body,
      parsedData: data,
      userBranchId: user.branchId,
    });
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

  const payments = data.payments;
  const singlePaymentMethod = data.paymentMethod;
  if (payments && payments.length > 0) {
    const sum = payments.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(sum - computedTotal) > 0.01) {
      // TEMP DEBUG: log mismatch between split payments and total (remove after debugging)
      // Location to remove later: backend-api-new/src/routes/sales.routes.ts (split payments check).
      console.error("[sales:create] split payments total mismatch", {
        computedTotal,
        payments,
        sum,
      });
      ctx.status = 400;
      ctx.body = {
        message: "Split payments total must equal sale total",
        error: { message: "Split payments total must equal sale total" },
      };
      return;
    }
  } else if (!singlePaymentMethod || singlePaymentMethod.trim() === "") {
    // TEMP DEBUG: log missing payment method (remove after debugging)
    // Location to remove later: backend-api-new/src/routes/sales.routes.ts (payment guard).
    console.error("[sales:create] missing payment method", {
      body,
      parsedData: data,
    });
    ctx.status = 400;
    ctx.body = {
      message: "Payment method or split payments is required",
      error: { message: "Payment method or split payments is required" },
    };
    return;
  }

  const referenceCode =
    data.referenceCode?.trim() ||
    (data.customerName?.trim() ? `Customer: ${data.customerName.trim()}` : null);

  const hasSplitPayments = Array.isArray(payments) && payments.length > 0;

  if (!hasSplitPayments && singlePaymentMethod && mapPaymentMethod(singlePaymentMethod) === "mpesa") {
    if (!referenceCode) {
      ctx.status = 400;
      ctx.body = {
        message: "M-Pesa transaction code is required",
        error: { message: "M-Pesa transaction code is required" },
      };
      return;
    }
  }

  if (hasSplitPayments) {
    for (const p of payments) {
      if (mapPaymentMethod(p.paymentMethod) === "mpesa" && p.amount > 0) {
        if (!p.referenceCode?.trim()) {
          ctx.status = 400;
          ctx.body = {
            message: "M-Pesa transaction code is required for each M-Pesa payment",
            error: { message: "M-Pesa transaction code is required for each M-Pesa payment" },
          };
          return;
        }
      }
    }
  }

  try {
    const createParams: Parameters<typeof createSale>[0] = {
      businessId: user.businessId,
      branchId,
      userId: user.id,
      items: data.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      totalAmount: computedTotal,
      paymentMethod: hasSplitPayments
        ? mapPaymentMethod(payments[0]!.paymentMethod)
        : mapPaymentMethod(singlePaymentMethod!),
      referenceCode: referenceCode ?? null,
      offlineId: data.offlineId ?? null,
    };

    if (hasSplitPayments) {
      createParams.payments = payments.map((p) => ({
        paymentMethod: mapPaymentMethod(p.paymentMethod),
        amount: p.amount,
        referenceCode: p.referenceCode?.trim() || null,
      }));
    }

    const created = await createSale(createParams);

    ctx.status = 201;
    ctx.body = {
      data: {
        id: created.id,
        totalAmount: created.totalAmount,
        date: created.soldAt,
      },
    };
  } catch (error) {
    // TEMP DEBUG: log unexpected errors during sale creation (remove after debugging)
    // Location to remove later: backend-api-new/src/routes/sales.routes.ts (catch block).
    console.error("[sales:create] unexpected error", {
      error,
      body,
      userId: user.id,
      branchId,
    });
    const err = error as Error & { status?: number };
    const status = typeof err.status === "number" ? err.status : 500;
    ctx.status = status;
    ctx.body = {
      message: err.message || "Failed to create sale",
      error: { message: err.message || "Failed to create sale" },
    };
  }
});

