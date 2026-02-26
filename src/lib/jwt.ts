import * as jose from "jose";
import { env } from "../config/env.js";

export interface JwtPayload {
  sub: string;
  email: string;
  role?: string | undefined;
}

export async function signAccessToken(payload: JwtPayload): Promise<string> {
  const secret = new TextEncoder().encode(env.jwtSecret);
  return new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(env.jwtAccessExpiry)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const secret = new TextEncoder().encode(env.jwtSecret);
  const { payload } = await jose.jwtVerify(token, secret);
  const role = payload.role;
  return {
    sub: payload.sub as string,
    email: (payload.email as string) ?? "",
    ...(typeof role === "string" ? { role } : {}),
  };
}

/** Refresh token payload (long-lived, used only to obtain new access tokens). */
export interface RefreshPayload {
  sub: string;
}

export async function signRefreshToken(payload: RefreshPayload): Promise<string> {
  const secret = new TextEncoder().encode(env.jwtSecret);
  return new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256", typ: "refresh" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(env.jwtRefreshExpiry)
    .sign(secret);
}

export async function verifyRefreshToken(token: string): Promise<RefreshPayload> {
  const secret = new TextEncoder().encode(env.jwtSecret);
  const { payload } = await jose.jwtVerify(token, secret);
  return { sub: payload.sub as string };
}
