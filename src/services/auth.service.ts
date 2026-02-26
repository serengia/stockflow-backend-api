import { eq, and } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { db } from "../db/index.js";
import { users, authProviders, businesses, branches } from "../db/schema/schema.js";
type DbUser = typeof users.$inferSelect;
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { env } from "../config/env.js";
import { sendWelcomeEmail } from "./email.service.js";
import { createAndSendEmailVerification, verifyEmailToken } from "./emailVerification.service.js";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  businessId: number;
  branchId: number | null;
  avatarUrl: string | null;
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

export async function register(params: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: AuthUser }> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);
  if (existing) {
    const err = new Error("Email already registered") as Error & {
      status?: number;
    };
    err.status = 409;
    throw err;
  }

  const passwordHash = await hashPassword(params.password);

  const [business] = await db
    .insert(businesses)
    .values({
      name: "My Business",
      ownerName: params.name,
      ownerEmail: normalizedEmail,
    })
    .returning({ id: businesses.id });
  if (!business) throw new Error("Failed to create business");

  const [branch] = await db
    .insert(branches)
    .values({ businessId: business.id, name: "Main" })
    .returning({ id: branches.id });
  if (!branch) throw new Error("Failed to create branch");

  const [user] = await db
    .insert(users)
    .values({
      businessId: business.id,
      branchId: branch.id,
      name: params.name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: "admin",
    })
    .returning();
  if (!user) throw new Error("Failed to create user");

  createAndSendEmailVerification(user.id, user.email, user.name).catch((err) => {
    console.error("[auth] Verification email failed:", err);
  });

  return { user: toAuthUser(user) };
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: AuthUser; token: string; refreshToken: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);
  if (!user) {
    const err = new Error("Invalid email or password") as Error & {
      status?: number;
    };
    err.status = 401;
    throw err;
  }
  if (!user.passwordHash) {
    const err = new Error(
      "Account uses Google sign-in. Please sign in with Google.",
    ) as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const err = new Error("Invalid email or password") as Error & {
      status?: number;
    };
    err.status = 401;
    throw err;
  }
  if (!user.emailVerified) {
    const err = new Error("Please verify your email before signing in.") as Error & {
      status?: number;
    };
    err.status = 403;
    throw err;
  }
  if (user.isActive !== 1) {
    const err = new Error("Account is disabled") as Error & { status?: number };
    err.status = 403;
    throw err;
  }
  const token = await signAccessToken({
    sub: String(user.id),
    email: user.email,
    role: user.role,
  });
  const refreshToken = await signRefreshToken({ sub: String(user.id) });
  return { user: toAuthUser(user), token, refreshToken };
}

export async function verifyEmail(token: string): Promise<{ user: AuthUser }> {
  const userId = await verifyEmailToken(token);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    const err = new Error("User not found") as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  if (user.isActive !== 1) {
    const err = new Error("Account is disabled") as Error & { status?: number };
    err.status = 403;
    throw err;
  }
  // Mark email as verified and send welcome email on first successful verification
  if (!user.emailVerified) {
    await db
      .update(users)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    sendWelcomeEmail({ to: user.email, name: user.name }).catch((err) => {
      console.error("[auth] Welcome email failed after verification:", err);
    });
  }
  return { user: toAuthUser(user) };
}

export async function loginWithGoogle(
  idToken: string,
): Promise<{ user: AuthUser; token: string; refreshToken: string }> {
  if (!env.googleClientId) {
    const err = new Error("Google sign-in is not configured") as Error & {
      status?: number;
    };
    err.status = 503;
    throw err;
  }
  const client = new OAuth2Client(env.googleClientId);
  const ticket = await client.verifyIdToken({
    idToken,
    audience: env.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    const err = new Error("Invalid Google token") as Error & {
      status?: number;
    };
    err.status = 401;
    throw err;
  }
  const providerUserId = payload.sub;
  const email = payload.email.toLowerCase();
  const name = payload.name ?? payload.email.split("@")[0] ?? "User";
  const picture = payload.picture ?? null;

  const [existingProvider] = await db
    .select({ userId: authProviders.userId })
    .from(authProviders)
    .where(
      and(
        eq(authProviders.provider, "google"),
        eq(authProviders.providerUserId, providerUserId),
      ),
    )
    .limit(1);

  if (existingProvider) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, existingProvider.userId))
      .limit(1);
    if (!user) {
      const err = new Error("User not found") as Error & { status?: number };
      err.status = 401;
      throw err;
    }
    if (user.isActive !== 1) {
      const err = new Error("Account is disabled") as Error & {
        status?: number;
      };
      err.status = 403;
      throw err;
    }
    const token = await signAccessToken({
      sub: String(user.id),
      email: user.email,
      role: user.role,
    });
    const refreshToken = await signRefreshToken({ sub: String(user.id) });
    return { user: toAuthUser(user), token, refreshToken };
  }

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser) {
    await db.insert(authProviders).values({
      userId: existingUser.id,
      provider: "google",
      providerUserId,
      providerEmail: email,
    });
    if (existingUser.avatarUrl !== picture && picture) {
      await db
        .update(users)
        .set({ avatarUrl: picture, updatedAt: new Date() })
        .where(eq(users.id, existingUser.id));
    }
    const [updated] = await db
      .select()
      .from(users)
      .where(eq(users.id, existingUser.id))
      .limit(1);
    const user = updated ?? existingUser;
    if (user.isActive !== 1) {
      const err = new Error("Account is disabled") as Error & {
        status?: number;
      };
      err.status = 403;
      throw err;
    }
    const token = await signAccessToken({
      sub: String(user.id),
      email: user.email,
      role: user.role,
    });
    const refreshToken = await signRefreshToken({ sub: String(user.id) });
    return { user: toAuthUser(user), token, refreshToken };
  }

  const [business] = await db
    .insert(businesses)
    .values({
      name: "My Business",
      ownerName: name,
      ownerEmail: email,
    })
    .returning({ id: businesses.id });
  if (!business) throw new Error("Failed to create business");

  const [branch] = await db
    .insert(branches)
    .values({ businessId: business.id, name: "Main" })
    .returning({ id: branches.id });
  if (!branch) throw new Error("Failed to create branch");

  const [user] = await db
    .insert(users)
    .values({
      businessId: business.id,
      branchId: branch.id,
      name,
      email,
      passwordHash: null,
      avatarUrl: picture,
      role: "admin",
    })
    .returning();
  if (!user) throw new Error("Failed to create user");

  await db.insert(authProviders).values({
    userId: user.id,
    provider: "google",
    providerUserId,
    providerEmail: email,
  });

  const token = await signAccessToken({
    sub: String(user.id),
    email: user.email,
    role: user.role,
  });
  const refreshToken = await signRefreshToken({ sub: String(user.id) });

  sendWelcomeEmail({ to: user.email, name: user.name }).catch((err) => {
    console.error("[auth] Welcome email failed (Google sign-up):", err);
  });

  return { user: toAuthUser(user), token, refreshToken };
}

export async function refreshTokens(refreshToken: string): Promise<{
  user: AuthUser;
  token: string;
  refreshToken: string;
}> {
  const payload = await verifyRefreshToken(refreshToken);
  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    const err = new Error("Invalid refresh token") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.isActive !== 1) {
    const err = new Error("Invalid or expired refresh token") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  const token = await signAccessToken({
    sub: String(user.id),
    email: user.email,
    role: user.role,
  });
  const newRefreshToken = await signRefreshToken({ sub: String(user.id) });
  return { user: toAuthUser(user), token, refreshToken: newRefreshToken };
}

export async function getMe(userId: number): Promise<AuthUser | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.isActive !== 1) return null;
  return toAuthUser(user);
}
