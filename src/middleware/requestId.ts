import type Koa from "koa";
import { randomUUID } from "crypto";

const REQUEST_ID_HEADER = "x-request-id";

export async function requestId(ctx: Koa.Context, next: Koa.Next) {
  const existingId = ctx.get(REQUEST_ID_HEADER);
  const id = existingId || randomUUID();

  ctx.set(REQUEST_ID_HEADER, id);
  (ctx.state as { requestId?: string }).requestId = id;

  await next();
}

