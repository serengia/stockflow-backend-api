import { randomBytes, createHash } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { emailVerificationTokens } from "../db/schema/schema.js";
import { env } from "../config/env.js";
import { getTransporter, renderTemplate } from "./email.service.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAndSendEmailVerification(userId: number, email: string, name: string): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) return;

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db
    .delete(emailVerificationTokens)
    .where(and(eq(emailVerificationTokens.userId, userId), isNull(emailVerificationTokens.consumedAt)));

  await db.insert(emailVerificationTokens).values({
    userId,
    tokenHash,
    expiresAt,
  });

  const verificationUrl = `${env.appBaseUrl.replace(/\/+$/, "")}/verify-email?token=${encodeURIComponent(rawToken)}`;

  const html = await renderTemplate("verify-email", {
    name,
    verificationUrl,
    year: new Date().getFullYear(),
  });

  await transporter.sendMail({
    from: env.mailFrom,
    to: email,
    subject: "Verify your email for Stockflow",
    html,
    text: `Hi ${name},

Please verify your email address to finish setting up your Stockflow account.

Open this link in your browser:
${verificationUrl}

If you didn’t create an account, you can safely ignore this email.

— The Stockflow team`,
  });
}

export async function verifyEmailToken(rawToken: string): Promise<number> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const [record] = await db
    .select()
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.tokenHash, tokenHash),
        gt(emailVerificationTokens.expiresAt, now),
        isNull(emailVerificationTokens.consumedAt),
      ),
    )
    .limit(1);

  if (!record) {
    const err = new Error("Invalid or expired verification token") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  await db
    .update(emailVerificationTokens)
    .set({ consumedAt: now })
    .where(eq(emailVerificationTokens.id, record.id));
  return record.userId;
}

