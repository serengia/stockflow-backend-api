import { randomBytes } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  branches,
  businesses,
  staffInvitations,
  users,
} from "../db/schema/schema.js";
import { hashPassword } from "../lib/password.js";
import { env } from "../config/env.js";
import { sendStaffInvitationEmail } from "./email.service.js";
import type { AuthUser } from "./auth.service.js";

type DbUser = typeof users.$inferSelect;

export interface StaffInvitationInfo {
  email: string;
  role: string;
  businessId: number;
  branchId: number | null;
  businessName: string;
  branchName: string | null;
  isExistingUserForThisBusiness: boolean;
}

export type StaffRole = "admin" | "manager" | "attendant";

export interface CreateInvitationParams {
  inviterUserId: number;
  businessId: number;
  email: string;
  role: StaffRole;
  branchId?: number | null;
}

export interface AcceptInvitationParams {
  token: string;
  userId?: number;
  name?: string;
  password?: string;
}

function toAuthUser(row: DbUser): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    businessId: row.businessId,
    branchId: row.branchId,
    avatarUrl: row.avatarUrl ?? null,
  };
}

export async function createInvitation(params: CreateInvitationParams) {
  const normalizedEmail = params.email.trim().toLowerCase();

  const [inviter] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, params.inviterUserId), eq(users.businessId, params.businessId)))
    .limit(1);

  if (!inviter) {
    const err = new Error("Inviter not found for this business") as Error & { status?: number };
    err.status = 403;
    throw err;
  }

  if (inviter.role !== "admin" && inviter.role !== "manager") {
    const err = new Error("You do not have permission to invite staff") as Error & {
      status?: number;
    };
    err.status = 403;
    throw err;
  }

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (existingUser && existingUser.businessId !== params.businessId) {
    const err = new Error(
      "This email is already used for a different business. Ask them to sign in with that account.",
    ) as Error & { status?: number };
    err.status = 409;
    throw err;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [invitation] = await db
    .insert(staffInvitations)
    .values({
      businessId: params.businessId,
      inviterUserId: params.inviterUserId,
      email: normalizedEmail,
      role: params.role,
      branchId: params.branchId ?? null,
      token,
      expiresAt,
    })
    .returning();

  if (!invitation) {
    throw new Error("Failed to create staff invitation");
  }

  const inviteUrl = `${env.appBaseUrl.replace(/\/+$/, "")}/accept-invite?token=${encodeURIComponent(
    token,
  )}`;

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, params.businessId))
    .limit(1);

  const businessName = business?.name ?? "your business";

  sendStaffInvitationEmail({
    to: normalizedEmail,
    invitedEmail: normalizedEmail,
    businessName,
    role: params.role,
    inviterName: inviter.name,
    inviteUrl,
  }).catch((err) => {
    console.error("[staff-invitations] Failed to send invitation email:", err);
  });

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
  };
}

export async function getInvitationByToken(token: string): Promise<StaffInvitationInfo> {
  const now = new Date();

  const [invitation] = await db
    .select()
    .from(staffInvitations)
    .where(
      and(
        eq(staffInvitations.token, token),
        gt(staffInvitations.expiresAt, now),
        isNull(staffInvitations.acceptedAt),
      ),
    )
    .limit(1);

  if (!invitation) {
    const err = new Error("Invalid or expired invitation") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, invitation.businessId))
    .limit(1);

  if (!business) {
    const err = new Error("Business for this invitation no longer exists") as Error & {
      status?: number;
    };
    err.status = 410;
    throw err;
  }

  const branchId = invitation.branchId ?? null;
  let branchName: string | null = null;

  if (branchId != null) {
    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);
    branchName = branch?.name ?? null;
  }

  const [existingUser] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, invitation.email), eq(users.businessId, invitation.businessId)))
    .limit(1);

  return {
    email: invitation.email,
    role: invitation.role,
    businessId: invitation.businessId,
    branchId,
    businessName: business.name,
    branchName,
    isExistingUserForThisBusiness: !!existingUser,
  };
}

export async function acceptInvitation(
  params: AcceptInvitationParams,
): Promise<{ user: AuthUser }> {
  const now = new Date();

  const [invitation] = await db
    .select()
    .from(staffInvitations)
    .where(
      and(
        eq(staffInvitations.token, params.token),
        gt(staffInvitations.expiresAt, now),
        isNull(staffInvitations.acceptedAt),
      ),
    )
    .limit(1);

  if (!invitation) {
    const err = new Error("Invalid or expired invitation") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  let user: DbUser | undefined;

  if (params.userId != null) {
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    if (!existing) {
      const err = new Error("User not found") as Error & { status?: number };
      err.status = 404;
      throw err;
    }

    if (existing.email.toLowerCase() !== invitation.email.toLowerCase()) {
      const err = new Error("This invitation was sent to a different email address") as Error & {
        status?: number;
      };
      err.status = 403;
      throw err;
    }

    if (existing.businessId !== invitation.businessId) {
      const err = new Error(
        "This account belongs to a different business and cannot accept this invitation.",
      ) as Error & { status?: number };
      err.status = 409;
      throw err;
    }

    const [updated] = await db
      .update(users)
      .set({
        role: invitation.role,
        branchId: invitation.branchId ?? existing.branchId,
      })
      .where(eq(users.id, existing.id))
      .returning();

    user = updated ?? existing;
  } else {
    if (!params.name || !params.password) {
      const err = new Error("Name and password are required to accept this invitation") as Error & {
        status?: number;
      };
      err.status = 400;
      throw err;
    }

    const [existingByEmail] = await db
      .select()
      .from(users)
      .where(eq(users.email, invitation.email))
      .limit(1);

    if (existingByEmail) {
      if (existingByEmail.businessId !== invitation.businessId) {
        const err = new Error(
          "An account with this email already exists for a different business. Please sign in with that account.",
        ) as Error & { status?: number };
        err.status = 409;
        throw err;
      }

      const err = new Error(
        "An account with this email already exists. Please sign in and accept the invite.",
      ) as Error & { status?: number };
      err.status = 409;
      throw err;
    }

    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, invitation.branchId ?? 0))
      .limit(1);

    if (!branch) {
      const [fallbackBranch] = await db
        .select()
        .from(branches)
        .where(eq(branches.businessId, invitation.businessId))
        .limit(1);

      if (!fallbackBranch) {
        const err = new Error(
          "No branch found for this business. Please contact the business owner.",
        ) as Error & { status?: number };
        err.status = 500;
        throw err;
      }

      const passwordHash = await hashPassword(params.password);
      const [createdUser] = await db
        .insert(users)
        .values({
          businessId: invitation.businessId,
          branchId: fallbackBranch.id,
          name: params.name.trim(),
          email: invitation.email,
          passwordHash,
          role: invitation.role,
          emailVerified: true,
          isActive: 1,
        })
        .returning();

      user = createdUser;
    } else {
      const passwordHash = await hashPassword(params.password);
      const [createdUser] = await db
        .insert(users)
        .values({
          businessId: invitation.businessId,
          branchId: branch.id,
          name: params.name.trim(),
          email: invitation.email,
          passwordHash,
          role: invitation.role,
          emailVerified: true,
          isActive: 1,
        })
        .returning();

      user = createdUser;
    }
  }

  if (!user) {
    throw new Error("Failed to resolve user for invitation");
  }

  await db
    .update(staffInvitations)
    .set({
      acceptedAt: now,
      acceptedUserId: user.id,
    })
    .where(eq(staffInvitations.id, invitation.id));

  return { user: toAuthUser(user) };
}

