import type { Context, Next } from "koa";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
}

const buckets = new Map<string, { count: number; expiresAt: number }>();

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, keyPrefix = "rl" } = options;

  return async function rateLimitMiddleware(ctx: Context, next: Next) {
    const ip = ctx.ip || ctx.request.ip || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.expiresAt <= now) {
      buckets.set(key, { count: 1, expiresAt: now + windowMs });
    } else {
      existing.count += 1;
      if (existing.count > max) {
        ctx.status = 429;
        ctx.body = {
          message: "Too many requests. Please try again later.",
        };
        return;
      }
    }

    await next();
  };
}

