import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import * as authService from "../services/auth.service.js";
import * as passwordResetService from "../services/passwordReset.service.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";

interface RequestWithBody {
  body?: unknown;
}

const registerBody = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const loginBody = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

const googleBody = z.object({
  idToken: z.string().min(1, "idToken is required"),
});

const refreshBody = z.object({
  refreshToken: z.string().min(1, "refreshToken is required"),
});

const verifyEmailBody = z.object({
  token: z.string().min(1, "token is required"),
});

const forgotPasswordBody = z.object({
  email: z.string().email("Invalid email"),
});

const resetPasswordBody = z.object({
  token: z.string().min(1, "token is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return (issue && "message" in issue ? String(issue.message) : undefined) ?? "Validation failed";
}

export const authRouter = new Router({ prefix: "/auth" });

authRouter.post(
  "/register",
  rateLimit({ windowMs: 10 * 60 * 1000, max: 20, keyPrefix: "register" }),
  async (ctx: Context) => {
  const body = (ctx.request as RequestWithBody).body;
  const parsed = registerBody.safeParse(body);
  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }
  const { user } = await authService.register(parsed.data);
  ctx.status = 201;
  ctx.body = {
    message: "Verification email sent. Please check your inbox to verify your email address.",
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

authRouter.post("/login", async (ctx: Context) => {
  const body = (ctx.request as RequestWithBody).body;
  const parsed = loginBody.safeParse(body);
  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }
  const { user, token, refreshToken } = await authService.login(parsed.data.email, parsed.data.password);
  ctx.status = 200;
  ctx.body = {
    token,
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
});

authRouter.post("/google", async (ctx: Context) => {
  const body = (ctx.request as RequestWithBody).body;
  const parsed = googleBody.safeParse(body);
  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }
  const { user, token, refreshToken } = await authService.loginWithGoogle(parsed.data.idToken);
  ctx.status = 200;
  ctx.body = {
    token,
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
});

authRouter.post("/refresh", async (ctx: Context) => {
  const body = (ctx.request as RequestWithBody).body;
  const parsed = refreshBody.safeParse(body);
  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }
  try {
    const { user, token, refreshToken } = await authService.refreshTokens(parsed.data.refreshToken);
    ctx.status = 200;
    ctx.body = {
      token,
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
  } catch (err) {
    const e = err as Error & { status?: number };
    ctx.status = e.status ?? 401;
    ctx.body = {
      message: e.message ?? "Invalid or expired refresh token",
      error: { message: e.message ?? "Invalid or expired refresh token" },
    };
  }
});

authRouter.post("/verify-email", async (ctx: Context) => {
  const body = (ctx.request as RequestWithBody).body;
  const parsed = verifyEmailBody.safeParse(body);
  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }
  const { user } = await authService.verifyEmail(parsed.data.token);
  ctx.status = 200;
  ctx.body = {
    message: "Email verified successfully",
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
});

authRouter.post(
  "/forgot-password",
  rateLimit({ windowMs: 10 * 60 * 1000, max: 10, keyPrefix: "forgot-password" }),
  async (ctx: Context) => {
    const body = (ctx.request as RequestWithBody).body;
    const parsed = forgotPasswordBody.safeParse(body);
    if (!parsed.success) {
      ctx.status = 400;
      const msg = firstIssueMessage(parsed.error);
      ctx.body = { message: msg, error: { message: msg } };
      return;
    }

    await passwordResetService.createAndSendPasswordReset(parsed.data.email);

    ctx.status = 200;
    ctx.body = {
      message: "If an account exists for that email, a password reset link has been sent.",
    };
  },
);

authRouter.post("/reset-password", async (ctx: Context) => {
  const body = (ctx.request as RequestWithBody).body;
  const parsed = resetPasswordBody.safeParse(body);
  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  await passwordResetService.resetPassword(parsed.data.token, parsed.data.password);

  ctx.status = 200;
  ctx.body = {
    message: "Password reset successfully",
  };
});

authRouter.get("/me", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as authService.AuthUser;
  ctx.status = 200;
  ctx.body = {
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
});
