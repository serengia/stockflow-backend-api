import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { and, eq, gte, lte } from "drizzle-orm";
import { requirePlatformAdmin } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import { db } from "../db/index.js";
import {
  businesses,
  branches,
  users,
  sales,
  returns,
  auditTrail,
} from "../db/schema/schema.js";
import { signAccessToken } from "../lib/jwt.js";

interface RequestWithQuery {
  query?: Record<string, unknown>;
}

interface RequestWithBody {
  body?: unknown;
}

const dateRangeSchema = z.object({
  from: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
  to: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
});

const listBusinessesQuerySchema = dateRangeSchema.extend({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
});

const updateBusinessStatusBody = z.object({
  status: z.enum(["active", "suspended", "closed"]),
  reason: z.string().max(500).optional(),
});

const listPlatformAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  businessId: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return undefined;
    }),
  userId: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return undefined;
    }),
  action: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
  from: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
  to: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
});

const startImpersonationBodySchema = z.object({
  businessId: z.number().int().positive(),
  userId: z.number().int().positive().optional(),
});

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return (
    (issue && "message" in issue ? String(issue.message) : undefined) ??
    "Validation failed"
  );
}

export const platformRouter = new Router({
  prefix: "/platform",
});

// GET /api/v1/platform/overview
platformRouter.get(
  "/overview",
  requirePlatformAdmin,
  async (ctx: Context): Promise<void> => {
    const query = (ctx.request as RequestWithQuery).query ?? {};
    const parsed = dateRangeSchema.safeParse(query);

    if (!parsed.success) {
      ctx.status = 400;
      const msg = firstIssueMessage(parsed.error);
      ctx.body = { message: msg, error: { message: msg } };
      return;
    }

    const { from, to } = parsed.data;
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
        d.setHours(23, 59, 59, 999);
        toDate = d;
      }
    }

    const allBusinesses = await db
      .select({
        id: businesses.id,
        name: businesses.name,
        status: businesses.status,
        createdAt: businesses.createdAt,
      })
      .from(businesses);

    const totalBusinesses = allBusinesses.length;
    const activeBusinesses = allBusinesses.filter(
      (b) => b.status === "active",
    ).length;

    let newBusinesses = 0;
    if (fromDate || toDate) {
      newBusinesses = allBusinesses.filter((b) => {
        if (!b.createdAt) return false;
        const created = new Date(b.createdAt);
        if (Number.isNaN(created.getTime())) return false;
        if (fromDate && created < fromDate) return false;
        if (toDate && created > toDate) return false;
        return true;
      }).length;
    }

    const saleConditions = [];
    if (fromDate) {
      saleConditions.push(gte(sales.soldAt, fromDate));
    }
    if (toDate) {
      saleConditions.push(lte(sales.soldAt, toDate));
    }

    const returnConditions = [];
    if (fromDate) {
      returnConditions.push(gte(returns.createdAt, fromDate));
    }
    if (toDate) {
      returnConditions.push(lte(returns.createdAt, toDate));
    }

    const salesQuery = db
      .select({
        businessId: sales.businessId,
        totalAmount: sales.totalAmount,
      })
      .from(sales);

    const returnsQuery = db
      .select({
        businessId: returns.businessId,
        totalAmount: returns.totalAmount,
      })
      .from(returns);

    const salesRows =
      saleConditions.length > 0
        ? await salesQuery.where(and(...saleConditions))
        : await salesQuery;

    const returnRows =
      returnConditions.length > 0
        ? await returnsQuery.where(and(...returnConditions))
        : await returnsQuery;

    let totalOrders = 0;
    let totalGmv = 0;
    const perBusinessStats = new Map<
      number,
      { businessId: number; gmv: number; orders: number }
    >();

    for (const row of salesRows) {
      totalOrders += 1;
      const amount = Number(row.totalAmount ?? 0);
      if (Number.isFinite(amount)) {
        totalGmv += amount;
      }
      const key = row.businessId;
      const existing =
        perBusinessStats.get(key) ?? { businessId: key, gmv: 0, orders: 0 };
      existing.gmv += amount;
      existing.orders += 1;
      perBusinessStats.set(key, existing);
    }

    let totalReturns = 0;
    for (const row of returnRows) {
      const amount = Number(row.totalAmount ?? 0);
      if (Number.isFinite(amount)) {
        totalReturns += amount;
      }
    }

    const netSales = totalGmv - totalReturns;

    const businessNameById = new Map<number, string>();
    for (const b of allBusinesses) {
      businessNameById.set(b.id, b.name);
    }

    const topBusinesses = Array.from(perBusinessStats.values())
      .map((stat) => ({
        businessId: stat.businessId,
        name: businessNameById.get(stat.businessId) ?? `Business ${stat.businessId}`,
        gmv: stat.gmv,
        orders: stat.orders,
      }))
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, 5);

    ctx.status = 200;
    ctx.body = {
      data: {
        totalBusinesses,
        activeBusinesses,
        newBusinesses,
        totalOrders,
        totalGmv,
        totalReturns,
        netSales,
        platformRevenue: 0,
        subscriptionRevenue: 0,
        topBusinesses,
      },
    };
  },
);

// GET /api/v1/platform/businesses
platformRouter.get(
  "/businesses",
  requirePlatformAdmin,
  async (ctx: Context): Promise<void> => {
    const query = (ctx.request as RequestWithQuery).query ?? {};
    const parsed = listBusinessesQuerySchema.safeParse(query);

    if (!parsed.success) {
      ctx.status = 400;
      const msg = firstIssueMessage(parsed.error);
      ctx.body = { message: msg, error: { message: msg } };
      return;
    }

    const { page = 1, limit = 20, status, from, to } = parsed.data;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (status) {
      conditions.push(eq(businesses.status, status));
    }

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
        d.setHours(23, 59, 59, 999);
        toDate = d;
      }
    }
    if (fromDate) {
      conditions.push(gte(businesses.createdAt, fromDate));
    }
    if (toDate) {
      conditions.push(lte(businesses.createdAt, toDate));
    }

    const baseQuery = db
      .select({
        id: businesses.id,
        name: businesses.name,
        ownerName: businesses.ownerName,
        ownerEmail: businesses.ownerEmail,
        phone: businesses.phone,
        status: businesses.status,
        createdAt: businesses.createdAt,
      })
      .from(businesses);

    const rows =
      conditions.length > 0
        ? await baseQuery
            .where(and(...conditions))
            .offset(offset)
            .limit(limit)
        : await baseQuery.offset(offset).limit(limit);

    ctx.status = 200;
    ctx.body = {
      data: rows,
      page,
      limit,
    };
  },
);

// POST /api/v1/platform/impersonation/start
platformRouter.post(
  "/impersonation/start",
  requirePlatformAdmin,
  async (ctx: Context): Promise<void> => {
    const current = ctx.state.user as AuthUser;
    const body = (ctx.request as RequestWithBody).body;
    const parsed = startImpersonationBodySchema.safeParse(body);

    if (!parsed.success) {
      ctx.status = 400;
      const msg = firstIssueMessage(parsed.error);
      ctx.body = { message: msg, error: { message: msg } };
      return;
    }

    const { businessId, userId } = parsed.data;

    let targetUser:
      | (typeof users.$inferSelect & { id: number; email: string })
      | undefined;

    if (typeof userId === "number") {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, userId), eq(users.businessId, businessId)))
        .limit(1);
      if (!row || row.isActive !== 1) {
        ctx.status = 404;
        ctx.body = {
          message: "Target user not found or inactive for this business",
          error: {
            message: "Target user not found or inactive for this business",
          },
        };
        return;
      }
      targetUser = row;
    } else {
      const [adminUser] = await db
        .select()
        .from(users)
        .where(and(eq(users.businessId, businessId), eq(users.role, "admin")))
        .limit(1);

      if (adminUser && adminUser.isActive === 1) {
        targetUser = adminUser;
      } else {
        const [anyUser] = await db
          .select()
          .from(users)
          .where(eq(users.businessId, businessId))
          .limit(1);
        if (!anyUser || anyUser.isActive !== 1) {
          ctx.status = 404;
          ctx.body = {
            message: "No active user found for this business to impersonate",
            error: {
              message: "No active user found for this business to impersonate",
            },
          };
          return;
        }
        targetUser = anyUser;
      }
    }

    const impersonationToken = await signAccessToken({
      sub: String(targetUser.id),
      email: targetUser.email,
      role: targetUser.role,
      businessId: targetUser.businessId,
      branchId: targetUser.branchId,
      impersonatedBy: current.id,
    });

    await db.insert(auditTrail).values({
      businessId: businessId,
      userId: current.id,
      entityType: "user",
      entityId: String(targetUser.id),
      action: "login",
      description: `Platform admin ${current.id} started impersonation of user ${targetUser.id} on business ${businessId}`,
    });

    ctx.status = 200;
    ctx.body = {
      token: impersonationToken,
      user: {
        id: String(targetUser.id),
        email: targetUser.email,
        name: targetUser.name,
        role: targetUser.role,
        businessId: targetUser.businessId,
        branchId: targetUser.branchId,
      },
    };
  },
);

// GET /api/v1/platform/businesses/:id
platformRouter.get(
  "/businesses/:id",
  requirePlatformAdmin,
  async (ctx: Context): Promise<void> => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      ctx.status = 400;
      ctx.body = { message: "Invalid business id", error: { message: "Invalid business id" } };
      return;
    }

    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, id))
      .limit(1);

    if (!business) {
      ctx.status = 404;
      ctx.body = { message: "Business not found", error: { message: "Business not found" } };
      return;
    }

    const [owner] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.businessId, business.id),
          eq(users.role, "admin"),
        ),
      )
      .limit(1);

    const businessBranches = await db
      .select()
      .from(branches)
      .where(eq(branches.businessId, business.id));

    const businessUsers = await db
      .select()
      .from(users)
      .where(eq(users.businessId, business.id));

    const businessSales = await db
      .select({
        id: sales.id,
        totalAmount: sales.totalAmount,
      })
      .from(sales)
      .where(eq(sales.businessId, business.id));

    const totalOrders = businessSales.length;
    const totalGmv = businessSales.reduce((sum, s) => {
      const amount = Number(s.totalAmount ?? 0);
      return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);

    ctx.status = 200;
    ctx.body = {
      data: {
        business,
        owner: owner ?? null,
        stats: {
          branches: businessBranches.length,
          users: businessUsers.length,
          orders: totalOrders,
          gmv: totalGmv,
        },
      },
    };
  },
);

// PATCH /api/v1/platform/businesses/:id/status
platformRouter.patch(
  "/businesses/:id/status",
  requirePlatformAdmin,
  async (ctx: Context): Promise<void> => {
    const current = ctx.state.user as AuthUser;
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      ctx.status = 400;
      ctx.body = { message: "Invalid business id", error: { message: "Invalid business id" } };
      return;
    }

    const body = (ctx.request as RequestWithBody).body;
    const parsed = updateBusinessStatusBody.safeParse(body);
    if (!parsed.success) {
      ctx.status = 400;
      const msg = firstIssueMessage(parsed.error);
      ctx.body = { message: msg, error: { message: msg } };
      return;
    }

    const [existing] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, id))
      .limit(1);

    if (!existing) {
      ctx.status = 404;
      ctx.body = { message: "Business not found", error: { message: "Business not found" } };
      return;
    }

    if (existing.status === parsed.data.status) {
      ctx.status = 200;
      ctx.body = { data: existing, message: "No changes" };
      return;
    }

    const [updated] = await db
      .update(businesses)
      .set({
        status: parsed.data.status,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, existing.id))
      .returning();

    if (!updated) {
      ctx.status = 500;
      ctx.body = {
        message: "Failed to update business status",
        error: { message: "Failed to update business status" },
      };
      return;
    }

    // Basic audit trail entry; can be extended in cross-cutting audit work
    await db.insert(auditTrail).values({
      businessId: updated.id,
      userId: current.id,
      entityType: "business",
      entityId: String(updated.id),
      action: "update",
      description:
        parsed.data.reason ??
        `Business status changed from ${existing.status} to ${updated.status} by platform admin`,
    });

    ctx.status = 200;
    ctx.body = { data: updated };
  },
);

// GET /api/v1/platform/audit-logs
platformRouter.get(
  "/audit-logs",
  requirePlatformAdmin,
  async (ctx: Context): Promise<void> => {
    const query = (ctx.request as RequestWithQuery).query ?? {};
    const parsed = listPlatformAuditQuerySchema.safeParse(query);

    if (!parsed.success) {
      ctx.status = 400;
      const msg = firstIssueMessage(parsed.error);
      ctx.body = { message: msg, error: { message: msg } };
      return;
    }

    const { page = 1, limit = 50, businessId, userId, action, from, to } =
      parsed.data;
    const offset = (page - 1) * limit;

    const conditions = [];

    if (typeof businessId === "number") {
      conditions.push(eq(auditTrail.businessId, businessId));
    }

    if (typeof userId === "number") {
      conditions.push(eq(auditTrail.userId, userId));
    }

    if (action) {
      // reuse the same normalized action semantics as audit.service
      const normalized = action.trim().toLowerCase();
      if (normalized === "login") {
        conditions.push(eq(auditTrail.action, "login"));
      } else if (normalized === "stock_change") {
        conditions.push(eq(auditTrail.action, "stock_change"));
      } else if (normalized === "create") {
        conditions.push(eq(auditTrail.action, "create"));
      } else if (normalized === "update") {
        conditions.push(eq(auditTrail.action, "update"));
      } else if (normalized === "delete") {
        conditions.push(eq(auditTrail.action, "delete"));
      }
    }

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
        d.setHours(23, 59, 59, 999);
        toDate = d;
      }
    }

    if (fromDate) {
      conditions.push(gte(auditTrail.createdAt, fromDate));
    }
    if (toDate) {
      conditions.push(lte(auditTrail.createdAt, toDate));
    }

    const baseQuery = db
      .select({
        id: auditTrail.id,
        businessId: auditTrail.businessId,
        userId: auditTrail.userId,
        entityType: auditTrail.entityType,
        entityId: auditTrail.entityId,
        action: auditTrail.action,
        description: auditTrail.description,
        createdAt: auditTrail.createdAt,
      })
      .from(auditTrail);

    const rows =
      conditions.length > 0
        ? await baseQuery
            .where(and(...conditions))
            .offset(offset)
            .limit(limit)
        : await baseQuery.offset(offset).limit(limit);

    ctx.status = 200;
    ctx.body = {
      data: rows,
      page,
      limit,
    };
  },
);

// Basic subscription & invoices placeholders so the platform UI can bind;
// replace with real subscription/billing data once modeled.
platformRouter.get(
  "/subscriptions",
  requirePlatformAdmin,
  async (ctx: Context): Promise<void> => {
    ctx.status = 200;
    ctx.body = {
      data: [],
      page: 1,
      limit: 0,
    };
  },
);

platformRouter.get(
  "/invoices",
  requirePlatformAdmin,
  async (ctx: Context): Promise<void> => {
    ctx.status = 200;
    ctx.body = {
      data: [],
      page: 1,
      limit: 0,
    };
  },
);

