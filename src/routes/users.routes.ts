import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import { db } from "../db/index.js";
import { users } from "../db/schema/schema.js";

interface RequestWithBody {
  body?: unknown;
}

const updateUserBody = z.object({
  name: z.string().min(1).max(255).optional(),
  phone: z.string().min(3).max(50).optional(),
  role: z.enum(["admin", "manager", "attendant"]).optional(),
  active: z.boolean().optional(),
});

export const usersRouter = new Router({ prefix: "/users" });

// GET /users - list all users for the current business
usersRouter.get("/", requireAuth, async (ctx: Context) => {
  const current = ctx.state.user as AuthUser;

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.businessId, current.businessId));

  ctx.status = 200;
  ctx.body = {
    users: rows.map((u) => ({
      id: String(u.id),
      name: u.name,
      email: u.email,
      phone: undefined as string | undefined, // phone not yet modeled on users table
      role: u.role,
      branchId: u.branchId,
      active: u.isActive === 1,
    })),
  };
});

// PATCH /users/:id - update basic user fields (admin/manager only)
usersRouter.patch("/:id", requireAuth, async (ctx: Context) => {
  const current = ctx.state.user as AuthUser;
  const targetId = Number(ctx.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid user id", error: { message: "Invalid user id" } };
    return;
  }

  if (current.role !== "admin" && current.role !== "manager") {
    ctx.status = 403;
    ctx.body = {
      message: "You do not have permission to manage users",
      error: { message: "You do not have permission to manage users" },
    };
    return;
  }

  const body = (ctx.request as RequestWithBody).body;
  const parsed = updateUserBody.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Validation failed";
    ctx.status = 400;
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, targetId), eq(users.businessId, current.businessId)))
    .limit(1);

  if (!existing) {
    ctx.status = 404;
    ctx.body = { message: "User not found", error: { message: "User not found" } };
    return;
  }

  const patch: Partial<typeof users.$inferInsert> = {};
  if (parsed.data.name != null) patch.name = parsed.data.name.trim();
  if (parsed.data.role != null) patch.role = parsed.data.role;
  if (parsed.data.active != null) patch.isActive = parsed.data.active ? 1 : 0;

  // phone is not currently stored in users table; ignore for now

  if (Object.keys(patch).length === 0) {
    ctx.status = 200;
    ctx.body = { message: "No changes", user: existing };
    return;
  }

  const [updated] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, existing.id))
    .returning();

  if (!updated) {
    ctx.status = 500;
    ctx.body = { message: "Update failed", error: { message: "Update failed" } };
    return;
  }

  ctx.status = 200;
  ctx.body = {
    user: {
      id: String(updated.id),
      name: updated.name,
      email: updated.email,
      role: updated.role,
      branchId: updated.branchId,
      active: updated.isActive === 1,
    },
  };
});

