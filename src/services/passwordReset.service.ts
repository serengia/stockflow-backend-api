import { randomBytes, createHash } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { passwordResetTokens, users } from "../db/schema/schema.js";
import { env } from "../config/env.js";
import { getTransporter, renderTemplate } from "./email.service.js";
import { hashPassword } from "../lib/password.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a password reset token for the given email and sends a reset email if:
 * - the user exists, and
 * - the account has a password (i.e. is not Google-only).
 *
 * This function is deliberately "blind" to callers: it does not reveal whether
 * a user exists or not. Callers should always return a generic success message.
 */
export async function createAndSendPasswordReset(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  // If user doesn't exist or has no password (Google-only), silently no-op
  if (!user || !user.passwordHash) {
    return;
  }

  const transporter = getTransporter();
  if (!transporter) return;

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db
    .delete(passwordResetTokens)
    .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.consumedAt)));

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  const resetUrl = `${env.appBaseUrl.replace(/\/+$/, "")}/reset-password?token=${encodeURIComponent(rawToken)}`;

  const html = await renderTemplate("reset-password", {
    name: user.name,
    resetUrl,
    year: new Date().getFullYear(),
  });

  await transporter.sendMail({
    from: env.mailFrom,
    to: user.email,
    subject: "Reset your Stockflow password",
    html,
    text: `Hi ${user.name},

We received a request to reset the password for your Stockflow account.

Open this link in your browser to choose a new password:
${resetUrl}

If you didn’t request this, you can safely ignore this email and your password will stay the same.

— The Stockflow team`,
  });
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const [record] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        gt(passwordResetTokens.expiresAt, now),
        isNull(passwordResetTokens.consumedAt),
      ),
    )
    .limit(1);

  if (!record) {
    const err = new Error("Invalid or expired reset token") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const [user] = await db.select().from(users).where(eq(users.id, record.userId)).limit(1);
  if (!user) {
    const err = new Error("User not found for reset token") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const passwordHash = await hashPassword(newPassword);

  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await db
    .update(passwordResetTokens)
    .set({ consumedAt: now })
    .where(eq(passwordResetTokens.id, record.id));
}

