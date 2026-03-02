import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditTrail, users } from "../db/schema/schema.js";

type DbAudit = typeof auditTrail.$inferSelect;

export interface ListedAuditLog {
  id: number;
  userId: number;
  userName: string | null;
  action: DbAudit["action"];
  entity: string;
  entityId: string;
  description: string | null;
  timestamp: DbAudit["createdAt"];
}

function toListedAudit(row: DbAudit & { userName: string | null }): ListedAuditLog {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    action: row.action,
    entity: row.entityType,
    entityId: row.entityId,
    description: row.description ?? null,
    timestamp: row.createdAt,
  };
}

export async function listAuditLogs(params: {
  businessId: number;
  userId?: number;
  action?: string;
  from?: Date;
  to?: Date;
}): Promise<ListedAuditLog[]> {
  const { businessId, userId, action, from, to } = params;

  const conditions = [eq(auditTrail.businessId, businessId)];

  if (typeof userId === "number") {
    conditions.push(eq(auditTrail.userId, userId));
  }

  if (action && action.trim() !== "") {
    const normalized = action.trim().toLowerCase();
    if (normalized === "login") {
      conditions.push(eq(auditTrail.action, "login"));
    } else if (normalized === "stock_change") {
      conditions.push(eq(auditTrail.action, "stock_change"));
    }
  }

  if (from) {
    conditions.push(gte(auditTrail.createdAt, from));
  }

  if (to) {
    conditions.push(lte(auditTrail.createdAt, to));
  }

  const rows = await db
    .select({
      id: auditTrail.id,
      businessId: auditTrail.businessId,
      userId: auditTrail.userId,
      entityType: auditTrail.entityType,
      entityId: auditTrail.entityId,
      action: auditTrail.action,
      description: auditTrail.description,
      createdAt: auditTrail.createdAt,
      userName: users.name,
    })
    .from(auditTrail)
    .innerJoin(users, eq(auditTrail.userId, users.id))
    .where(and(...conditions))
    .orderBy(auditTrail.createdAt);

  return rows.map(toListedAudit);
}

