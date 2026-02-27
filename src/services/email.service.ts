import path from "path";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import ejs from "ejs";
import { env } from "../config/env.js";

// Use project root so views work from both src/ (tsx) and dist/ (node)
const EMAIL_VIEWS_DIR = path.join(process.cwd(), "views", "emails");

function isMailConfigured(): boolean {
  const { host, port, user, pass } = env.mailtrap;
  return !!(host && port != null && user && pass);
}

export function getTransporter(): Transporter | null {
  if (!isMailConfigured()) return null;
  const { host, port, user, pass } = env.mailtrap;
  return nodemailer.createTransport({
    host,
    port: port ?? 2525,
    secure: false,
    auth: { user: user!, pass: pass! },
  });
}

/**
 * Renders an EJS email template (uses same engine as koa-ejs).
 * Templates live in views/emails/; use partials for header/footer.
 */
export async function renderTemplate(
  templateName: string,
  data: Record<string, unknown> = {},
): Promise<string> {
  const templatePath = path.join(EMAIL_VIEWS_DIR, `${templateName}.ejs`);
  return ejs.renderFile(templatePath, data, {
    views: [EMAIL_VIEWS_DIR],
    async: true,
  }) as Promise<string>;
}

export interface SendWelcomeEmailParams {
  to: string;
  name: string;
}

/**
 * Sends a welcome email after signup. No-op if Mailtrap is not configured.
 */
export async function sendWelcomeEmail(params: SendWelcomeEmailParams): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    return;
  }
  const html = await renderTemplate("welcome", {
    name: params.name,
    year: new Date().getFullYear(),
  });
  await transporter.sendMail({
    from: env.mailFrom,
    to: params.to,
    subject: "Welcome to Stockflow",
    html,
    text: `Welcome, ${params.name}! Thanks for signing up. You're all set to manage your inventory and sales in one place. — The Stockflow team`,
  });
}

export interface SendStaffInvitationEmailParams {
  to: string;
  invitedEmail: string;
  businessName: string;
  role: string;
  inviterName: string;
  inviteUrl: string;
}

/**
 * Sends a staff invitation email with a secure link. No-op if Mailtrap is not configured.
 */
export async function sendStaffInvitationEmail(
  params: SendStaffInvitationEmailParams,
): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    return;
  }

  const html = await renderTemplate("staff-invitation", {
    inviterName: params.inviterName,
    invitedEmail: params.invitedEmail,
    businessName: params.businessName,
    role: params.role,
    inviteUrl: params.inviteUrl,
    year: new Date().getFullYear(),
  });

  await transporter.sendMail({
    from: env.mailFrom,
    to: params.to,
    subject: `You're invited to join ${params.businessName} on Stockflow`,
    html,
    text: `Hi,

${params.inviterName} has invited you to join ${params.businessName} on Stockflow as ${params.role}.

Open this link in your browser to accept the invitation:
${params.inviteUrl}

If you weren't expecting this, you can safely ignore this email.

— The Stockflow team`,
  });
}
