import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import {
  acceptInvitation,
  createInvitation,
  getInvitationByToken,
} from "../services/staff-invitations.service.js";
import { signAccessToken, signRefreshToken } from "../lib/jwt.js";
import { db } from "../db/index.js";
import { staffInvitations } from "../db/schema/schema.js";

interface RequestWithBody {
  body?: unknown;
}

const inviteBodySchema = z.object({
  email: z.string().email("Invalid email"),
  role: z.enum(["admin", "manager", "attendant"]).default("attendant"),
  branchId: z.number().int().positive().optional(),
});

export const staffInvitationsRouter = new Router();

// Primary, documented endpoint (matches plan): POST /staff-invitations
staffInvitationsRouter.post(
  "/staff-invitations",
  requireAuth,
  async (ctx: Context) => {
    const user = ctx.state.user as AuthUser;
    const body = (ctx.request as RequestWithBody).body;
    const parsed = inviteBodySchema.safeParse(body);
    if (!parsed.success) {
      ctx.status = 400;
      const msg = parsed.error.issues[0]?.message ?? "Validation failed";
      ctx.body = { message: msg, error: { message: msg } };
      return;
    }

    const { email, role, branchId } = parsed.data;

    const invitation = await createInvitation({
      inviterUserId: user.id,
      businessId: user.businessId,
      email,
      role,
      branchId: branchId ?? null,
    });

    ctx.status = 201;
    ctx.body = {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  },
);

// List invitations for the current business/owner
staffInvitationsRouter.get(
  "/staff-invitations",
  requireAuth,
  async (ctx: Context) => {
    const user = ctx.state.user as AuthUser;

    const rows = await db
      .select()
      .from(staffInvitations)
      .where(and(eq(staffInvitations.businessId, user.businessId)))
      .orderBy(desc(staffInvitations.createdAt));

    ctx.status = 200;
    ctx.body = {
      invitations: rows.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        branchId: inv.branchId,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
        acceptedAt: inv.acceptedAt,
      })),
    };
  },
);

// Backwards-compatible endpoint for existing web-app: POST /users/invite
staffInvitationsRouter.post(
  "/users/invite",
  requireAuth,
  async (ctx: Context) => {
    const user = ctx.state.user as AuthUser;
    const body = (ctx.request as RequestWithBody).body;
    const parsed = inviteBodySchema.safeParse(body);
    if (!parsed.success) {
      ctx.status = 400;
      const msg = parsed.error.issues[0]?.message ?? "Validation failed";
      ctx.body = { message: msg, error: { message: msg } };
      return;
    }

    const { email, role, branchId } = parsed.data;

    const invitation = await createInvitation({
      inviterUserId: user.id,
      businessId: user.businessId,
      email,
      role,
      branchId: branchId ?? null,
    });

    ctx.status = 201;
    ctx.body = {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  },
);

// Public: GET /staff-invitations/:token
staffInvitationsRouter.get(
  "/staff-invitations/:token",
  async (ctx: Context) => {
    const token = ctx.params.token;
    if (!token) {
      ctx.status = 400;
      ctx.body = { message: "Invitation token is required", error: { message: "Invitation token is required" } };
      return;
    }

    const info = await getInvitationByToken(token);
    ctx.status = 200;
    ctx.body = info;
  },
);

const acceptBodySchema = z.object({
  name: z.string().min(1, "Name is required").max(255).optional(),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
});

// POST /staff-invitations/:token/accept
staffInvitationsRouter.post(
  "/staff-invitations/:token/accept",
  async (ctx: Context) => {
    const token = ctx.params.token;
    if (!token) {
      ctx.status = 400;
      ctx.body = { message: "Invitation token is required", error: { message: "Invitation token is required" } };
      return;
    }

    const maybeUser = ctx.state.user as AuthUser | undefined;
    const body = (ctx.request as RequestWithBody).body;
    const parsed = acceptBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      ctx.status = 400;
      const msg = parsed.error.issues[0]?.message ?? "Validation failed";
      ctx.body = { message: msg, error: { message: msg } };
      return;
    }

    const { name, password } = parsed.data;

    const acceptParams: Parameters<typeof acceptInvitation>[0] = { token };
    if (maybeUser?.id !== undefined) acceptParams.userId = maybeUser.id;
    if (name !== undefined) acceptParams.name = name;
    if (password !== undefined) acceptParams.password = password;

    const { user } = await acceptInvitation(acceptParams);

    // Issue tokens so newly accepted staff can go straight to dashboard
    const accessToken = await signAccessToken({
      sub: String(user.id),
      email: user.email,
      role: user.role,
      businessId: user.businessId,
      branchId: user.branchId,
    });
    const refreshToken = await signRefreshToken({ sub: String(user.id) });

    ctx.status = 200;
    ctx.body = {
      token: accessToken,
      refreshToken,
      user: {
        id: String(user.id),
        email: user.email,
        name: user.name,
        role: user.role,
        businessId: user.businessId,
        branchId: user.branchId,
        avatarUrl: user.avatarUrl,
      },
    };
  },
);

