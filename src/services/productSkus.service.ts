import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { productSkus, products } from "../db/schema/schema.js";

type DbSku = typeof productSkus.$inferSelect;

export interface Sku {
  id: number;
  code: string;
  reorderLevel: number;
}

function toSku(row: DbSku): Sku {
  return {
    id: row.id,
    code: row.code,
    reorderLevel: row.reorderLevel,
  };
}

export async function listSkus(params: { businessId: number }): Promise<Sku[]> {
  const rows = await db
    .select()
    .from(productSkus)
    .where(eq(productSkus.businessId, params.businessId))
    .orderBy(productSkus.code);

  return rows.map(toSku);
}

export async function createSku(params: {
  businessId: number;
  code: string;
  reorderLevel?: number;
}): Promise<Sku> {
  const code = params.code.trim().toUpperCase();
  if (!code) {
    const err = new Error("Code is required") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const [existing] = await db
    .select()
    .from(productSkus)
    .where(
      and(
        eq(productSkus.businessId, params.businessId),
        eq(productSkus.code, code),
      ),
    )
    .limit(1);

  if (existing) {
    const err = new Error("SKU code already exists") as Error & { status?: number };
    err.status = 409;
    throw err;
  }

  const [inserted] = await db
    .insert(productSkus)
    .values({
      businessId: params.businessId,
      code,
      reorderLevel:
        typeof params.reorderLevel === "number" && params.reorderLevel >= 0
          ? params.reorderLevel
          : 10,
    })
    .returning();

  if (!inserted) {
    const err = new Error("Failed to create SKU") as Error & { status?: number };
    err.status = 500;
    throw err;
  }

  return toSku(inserted);
}

export async function updateSku(params: {
  id: number;
  businessId: number;
  code?: string;
  reorderLevel?: number;
}): Promise<Sku> {
  const [existing] = await db
    .select()
    .from(productSkus)
    .where(
      and(
        eq(productSkus.businessId, params.businessId),
        eq(productSkus.id, params.id),
      ),
    )
    .limit(1);

  if (!existing) {
    const err = new Error("SKU not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const updateData: Partial<DbSku> = {};

  if (typeof params.code === "string") {
    const code = params.code.trim().toUpperCase();
    if (!code) {
      const err = new Error("Code is required") as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    const [duplicate] = await db
      .select()
      .from(productSkus)
      .where(
        and(
          eq(productSkus.businessId, params.businessId),
          eq(productSkus.code, code),
        ),
      )
      .limit(1);

    if (duplicate && duplicate.id !== existing.id) {
      const err = new Error("SKU code already exists") as Error & { status?: number };
      err.status = 409;
      throw err;
    }

    updateData.code = code;
  }

  if (typeof params.reorderLevel === "number" && params.reorderLevel >= 0) {
    updateData.reorderLevel = params.reorderLevel;
  }

  if (Object.keys(updateData).length === 0) {
    return toSku(existing);
  }

  const [updated] = await db
    .update(productSkus)
    .set({
      ...updateData,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(productSkus.businessId, params.businessId),
        eq(productSkus.id, params.id),
      ),
    )
    .returning();

  if (!updated) {
    const err = new Error("Failed to update SKU") as Error & { status?: number };
    err.status = 500;
    throw err;
  }

  return toSku(updated);
}

export async function deleteSku(params: {
  id: number;
  businessId: number;
}): Promise<void> {
  const [existing] = await db
    .select()
    .from(productSkus)
    .where(
      and(
        eq(productSkus.businessId, params.businessId),
        eq(productSkus.id, params.id),
      ),
    )
    .limit(1);

  if (!existing) {
    const err = new Error("SKU not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const [inUse] = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.businessId, params.businessId),
        eq(products.sku, existing.code),
      ),
    )
    .limit(1);

  if (inUse) {
    const err = new Error("Cannot delete SKU that is used by products") as Error & {
      status?: number;
    };
    err.status = 400;
    throw err;
  }

  await db
    .delete(productSkus)
    .where(
      and(
        eq(productSkus.businessId, params.businessId),
        eq(productSkus.id, params.id),
      ),
    )
    .returning({ id: productSkus.id });
}

