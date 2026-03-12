import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { and, eq, gte, lte } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import { db } from "../db/index.js";
import {
  cashRegisterEntries,
  sales,
  users,
  branches,
} from "../db/schema/schema.js";

const querySchema = z.object({
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

export const reportsRouter = new Router({
  prefix: "/reports",
});

reportsRouter.get("/mpesa-reconciliation", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const query = (ctx.request as { query?: Record<string, unknown> }).query ?? {};
  const parsed = querySchema.safeParse(query);

  if (!parsed.success) {
    ctx.status = 400;
    ctx.body = { message: "Invalid query parameters" };
    return;
  }

  const { from, to, branchId: branchIdFromQuery } = parsed.data;

  const branchId =
    typeof branchIdFromQuery === "number"
      ? branchIdFromQuery
      : user.branchId != null
        ? user.branchId
        : undefined;

  const conditions = [
    eq(cashRegisterEntries.businessId, user.businessId),
    eq(cashRegisterEntries.paymentMethod, "mpesa"),
  ];

  if (typeof branchId === "number") {
    conditions.push(eq(cashRegisterEntries.branchId, branchId));
  }

  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) {
      conditions.push(gte(cashRegisterEntries.recordedAt, d));
    }
  }

  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      conditions.push(lte(cashRegisterEntries.recordedAt, d));
    }
  }

  const rows = await db
    .select({
      id: cashRegisterEntries.id,
      saleId: cashRegisterEntries.saleId,
      amount: cashRegisterEntries.amount,
      referenceCode: cashRegisterEntries.referenceCode,
      recordedAt: cashRegisterEntries.recordedAt,
      branchId: cashRegisterEntries.branchId,
      branchName: branches.name,
      cashierName: users.name,
      cashierId: cashRegisterEntries.recordedByUserId,
      saleTotalAmount: sales.totalAmount,
      soldAt: sales.soldAt,
    })
    .from(cashRegisterEntries)
    .innerJoin(sales, eq(cashRegisterEntries.saleId, sales.id))
    .innerJoin(users, eq(cashRegisterEntries.recordedByUserId, users.id))
    .innerJoin(branches, eq(cashRegisterEntries.branchId, branches.id))
    .where(and(...conditions))
    .orderBy(cashRegisterEntries.recordedAt);

  let totalAmount = 0;
  let withReference = 0;
  let withoutReference = 0;

  const transactions = rows.map((row) => {
    const amount = Number(row.amount);
    totalAmount += amount;
    const hasRef = !!row.referenceCode && row.referenceCode.trim() !== "";
    if (hasRef) withReference++;
    else withoutReference++;

    return {
      id: row.id,
      saleId: row.saleId,
      amount,
      referenceCode: row.referenceCode || null,
      recordedAt: row.recordedAt,
      soldAt: row.soldAt,
      branchId: row.branchId,
      branchName: row.branchName,
      cashierName: row.cashierName,
      cashierId: row.cashierId,
      saleTotalAmount: Number(row.saleTotalAmount),
      hasReference: hasRef,
    };
  });

  ctx.status = 200;
  ctx.body = {
    data: transactions,
    summary: {
      totalAmount,
      totalTransactions: transactions.length,
      withReference,
      withoutReference,
    },
  };
});
