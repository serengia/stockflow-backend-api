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
  changes: Record<string, unknown> | null;
  timestamp: DbAudit["createdAt"];
}

function toListedAudit(row: DbAudit & { userName: string | null }): ListedAuditLog {
  let parsedChanges: Record<string, unknown> | null = null;
  if (row.description) {
    try {
      const maybeJson = JSON.parse(row.description);
      if (maybeJson && typeof maybeJson === "object") {
        parsedChanges = maybeJson as Record<string, unknown>;
      }
    } catch {
      // description is plain text; ignore JSON parsing failure
    }
  }

  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    action: row.action,
    entity: row.entityType,
    entityId: row.entityId,
    description: row.description ?? null,
    changes: parsedChanges,
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
    } else if (normalized === "create") {
      conditions.push(eq(auditTrail.action, "create"));
    } else if (normalized === "update") {
      conditions.push(eq(auditTrail.action, "update"));
    } else if (normalized === "delete") {
      conditions.push(eq(auditTrail.action, "delete"));
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

export async function recordAuditLog(params: {
  businessId: number;
  userId: number;
  entityType: string;
  entityId: string | number;
  action: DbAudit["action"];
  description?: string | null;
  changes?: Record<string, unknown> | null;
}): Promise<void> {
  const { businessId, userId, entityType, entityId, action, description, changes } = params;

  let descriptionToStore: string | null = null;

  if (changes && Object.keys(changes).length > 0) {
    try {
      descriptionToStore = JSON.stringify(changes);
    } catch {
      descriptionToStore = description ?? null;
    }
  } else {
    descriptionToStore = description ?? null;
  }

  await db.insert(auditTrail).values({
    businessId,
    userId,
    entityType,
    entityId: String(entityId),
    action,
    description: descriptionToStore,
  });
}

