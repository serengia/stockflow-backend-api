import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { promotions } from "../db/schema/schema.js";

type DbPromotion = typeof promotions.$inferSelect;

export interface Promotion {
  id: number;
  businessId: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  validFrom: string;
  validTo: string;
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toPromotion(row: DbPromotion): Promotion {
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    type: row.type ?? "percent_off",
    config: parseConfig(row.config),
    validFrom: row.validFrom ?? "",
    validTo: row.validTo && row.validTo.trim() ? row.validTo : "",
  };
}

export async function listPromotions(params: {
  businessId: number;
}): Promise<Promotion[]> {
  const { businessId } = params;

  const rows = await db
    .select()
    .from(promotions)
    .where(eq(promotions.businessId, businessId))
    .orderBy(promotions.name);

  return rows.map(toPromotion);
}

export async function getPromotionById(params: {
  id: number;
  businessId: number;
}): Promise<Promotion | null> {
  const { id, businessId } = params;

  const [row] = await db
    .select()
    .from(promotions)
    .where(and(eq(promotions.id, id), eq(promotions.businessId, businessId)))
    .limit(1);

  return row ? toPromotion(row) : null;
}

export async function createPromotion(params: {
  businessId: number;
  name: string;
  type: string;
  config?: Record<string, unknown> | null;
  validFrom: string;
  validTo?: string | null;
}): Promise<Promotion> {
  const { businessId, name, type, config, validFrom, validTo } = params;

  const [created] = await db
    .insert(promotions)
    .values({
      businessId,
      name: name.trim(),
      type: type.trim() || "percent_off",
      config: config != null ? JSON.stringify(config) : null,
      validFrom: validFrom.trim(),
      validTo: validTo?.trim() || null,
    })
    .returning();

  if (!created) {
    const err = new Error("Failed to create promotion") as Error & { status?: number };
    err.status = 500;
    throw err;
  }

  return toPromotion(created);
}

export async function updatePromotion(params: {
  id: number;
  businessId: number;
  name?: string;
  type?: string;
  config?: Record<string, unknown> | null;
  validFrom?: string;
  validTo?: string | null;
}): Promise<Promotion> {
  const { id, businessId, name, type, config, validFrom, validTo } = params;

  const [existing] = await db
    .select()
    .from(promotions)
    .where(and(eq(promotions.id, id), eq(promotions.businessId, businessId)))
    .limit(1);

  if (!existing) {
    const err = new Error("Promotion not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const updateData: Partial<DbPromotion> = {};
  if (typeof name === "string") updateData.name = name.trim();
  if (typeof type === "string") updateData.type = type.trim();
  if (config !== undefined) updateData.config = config != null ? JSON.stringify(config) : null;
  if (typeof validFrom === "string") updateData.validFrom = validFrom.trim();
  if (validTo !== undefined) updateData.validTo = validTo?.trim() || null;

  let updatedRow = existing;

  if (Object.keys(updateData).length > 0) {
    const [updated] = await db
      .update(promotions)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(and(eq(promotions.id, id), eq(promotions.businessId, businessId)))
      .returning();

    if (!updated) {
      const err = new Error("Failed to update promotion") as Error & { status?: number };
      err.status = 500;
      throw err;
    }

    updatedRow = updated;
  }

  return toPromotion(updatedRow);
}

export async function deletePromotion(params: {
  id: number;
  businessId: number;
}): Promise<void> {
  const { id, businessId } = params;

  const result = await db
    .delete(promotions)
    .where(and(eq(promotions.id, id), eq(promotions.businessId, businessId)))
    .returning({ id: promotions.id });

  if (!result[0]) {
    const err = new Error("Promotion not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
}
