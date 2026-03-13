import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import { getDashboardMetrics } from "../services/dashboard.service.js";

interface RequestWithQuery {
  query?: Record<string, unknown>;
}

const querySchema = z.object({
  branchId: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return undefined;
    }),
  days: z
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

export const dashboardRouter = new Router({
  prefix: "/dashboard",
});

dashboardRouter.get("/metrics", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const query = (ctx.request as RequestWithQuery).query ?? {};
  const parsed = querySchema.safeParse(query);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const { branchId: branchIdFromQuery, days } = parsed.data;

  const branchId =
    typeof branchIdFromQuery === "number"
      ? branchIdFromQuery
      : user.branchId != null
        ? user.branchId
        : undefined;

  const metrics = await getDashboardMetrics({
    businessId: user.businessId,
    branchId: branchId ?? null,
    days: days ?? 7,
  });

  ctx.status = 200;
  ctx.body = {
    data: {
      salesToday: metrics.salesToday,
      profitToday: metrics.profitToday,
      transactionsToday: metrics.transactionsToday,
      trend: metrics.trend,
      comparisons: metrics.comparisons,
      stockValueAtCost: metrics.stockValueAtCost,
    },
  };
});
