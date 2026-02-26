import type Koa from "koa";

export async function errorHandler(ctx: Koa.Context, next: Koa.Next) {
  try {
    await next();
  } catch (err) {
    const error = err as Error & { status?: number };

    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;

    ctx.status = status;
    const message = status === 500 ? "Internal server error" : error.message;
    ctx.body = {
      message,
      error: { message },
    };

    ctx.app.emit("error", error, ctx);
  }
}

