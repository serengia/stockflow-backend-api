import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_ACCESS_EXPIRY: z.string().default("15m"),
  JWT_REFRESH_EXPIRY: z.string().default("7d"), // Long-lived; used to get new access tokens
  GOOGLE_CLIENT_ID: z.string().optional(), // Required for Google ID token verification
  // Public app URL used in emails (for email verification links)
  APP_BASE_URL: z.string().optional(),
  // Mailtrap SMTP (optional – if missing, welcome emails are skipped)
  MAILTRAP_SMTP_HOST: z.string().optional(),
  MAILTRAP_SMTP_PORT: z.string().optional(),
  MAILTRAP_SMTP_USER: z.string().optional(),
  MAILTRAP_SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(), // e.g. "Stockflow <noreply@stockflow.com>"
  CLOUDINARY_CLOUD_NAME: z.string().min(1, "CLOUDINARY_CLOUD_NAME is required"),
  CLOUDINARY_API_KEY: z.string().min(1, "CLOUDINARY_API_KEY is required"),
  CLOUDINARY_API_SECRET: z.string().min(1, "CLOUDINARY_API_SECRET is required"),
});

const parsed = EnvSchema.parse(process.env);

export const env = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT ? Number(parsed.PORT) || 4000 : 4000,
  databaseUrl: parsed.DATABASE_URL,
  jwtSecret: parsed.JWT_SECRET,
  jwtAccessExpiry: parsed.JWT_ACCESS_EXPIRY,
  jwtRefreshExpiry: parsed.JWT_REFRESH_EXPIRY,
  googleClientId: parsed.GOOGLE_CLIENT_ID,
  appBaseUrl: parsed.APP_BASE_URL ?? "http://localhost:3000",
  mailtrap: {
    host: parsed.MAILTRAP_SMTP_HOST,
    port: parsed.MAILTRAP_SMTP_PORT ? Number(parsed.MAILTRAP_SMTP_PORT) : undefined,
    user: parsed.MAILTRAP_SMTP_USER,
    pass: parsed.MAILTRAP_SMTP_PASS,
  },
  mailFrom: parsed.MAIL_FROM ?? "Stockflow <noreply@stockflow.com>",
  cloudinary: {
    cloudName: parsed.CLOUDINARY_CLOUD_NAME,
    apiKey: parsed.CLOUDINARY_API_KEY,
    apiSecret: parsed.CLOUDINARY_API_SECRET,
  },
};


