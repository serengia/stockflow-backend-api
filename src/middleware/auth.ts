import type { Context, Next } from "koa";
import { verifyAccessToken, type JwtPayload } from "../lib/jwt.js";
import { getMe, type AuthUser } from "../services/auth.service.js";
import { env } from "../config/env.js";

export interface AuthState {
  user: AuthUser;
  payload: JwtPayload;
}

export async function requireAuth(ctx: Context, next: Next): Promise<void> {
  const authHeader = ctx.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    ctx.status = 401;
    ctx.body = { message: "Authentication required", error: { message: "Authentication required" } };
    return;
  }
  try {
    const payload = await verifyAccessToken(token);
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
      if (env.nodeEnv === "development") {
        (ctx as Context & { log?: { warn: (o: object) => void } }).log?.warn({
          authFailure: "invalid_sub",
          sub: payload.sub,
          message: "JWT sub is not a valid user id",
        });
      }
      ctx.status = 401;
      ctx.body = { message: "Invalid or expired token", error: { message: "Invalid or expired token" } };
      return;
    }
    const user = await getMe(userId);
    if (!user) {
      if (env.nodeEnv === "development") {
        (ctx as Context & { log?: { warn: (o: object) => void } }).log?.warn({
          authFailure: "user_not_found_or_inactive",
          userId,
          sub: payload.sub,
          message: "User not found or inactive; token may be from another environment or expired",
        });
      }
      ctx.status = 401;
      ctx.body = {
        message: "Session invalid. Please log in again.",
        error: { message: "Session invalid. Please log in again." },
      };
      return;
    }
    ctx.state.user = user;
    ctx.state.authPayload = payload;
    await next();
  } catch (err) {
    if (env.nodeEnv === "development") {
      (ctx as Context & { log?: { warn: (o: object) => void } }).log?.warn({
        authFailure: "jwt_verify_failed",
        message: err instanceof Error ? err.message : "Invalid or expired token",
      });
    }
    ctx.status = 401;
    ctx.body = {
      message: "Invalid or expired token. Please log in again.",
      error: { message: "Invalid or expired token. Please log in again." },
    };
  }
}
