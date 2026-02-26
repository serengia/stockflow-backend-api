import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { productCategories, products } from "../db/schema/schema.js";

type DbCategory = typeof productCategories.$inferSelect;

export interface Category {
  id: number;
  name: string;
}

function toCategory(row: DbCategory): Category {
  return {
    id: row.id,
    name: row.name,
  };
}

export async function listCategories(params: {
  businessId: number;
}): Promise<Category[]> {
  const rows = await db
    .select()
    .from(productCategories)
    .where(eq(productCategories.businessId, params.businessId))
    .orderBy(productCategories.name);

  return rows.map(toCategory);
}

export async function createCategory(params: {
  businessId: number;
  name: string;
}): Promise<Category> {
  const name = params.name.trim();
  if (!name) {
    const err = new Error("Name is required") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const [existing] = await db
    .select()
    .from(productCategories)
    .where(
      and(
        eq(productCategories.businessId, params.businessId),
        eq(productCategories.name, name),
      ),
    )
    .limit(1);

  if (existing) {
    const err = new Error("Category name already exists") as Error & {
      status?: number;
    };
    err.status = 409;
    throw err;
  }

  const [inserted] = await db
    .insert(productCategories)
    .values({
      businessId: params.businessId,
      name,
    })
    .returning();

  if (!inserted) {
    const err = new Error("Failed to create category") as Error & { status?: number };
    err.status = 500;
    throw err;
  }

  return toCategory(inserted);
}

export async function updateCategory(params: {
  id: number;
  businessId: number;
  name: string;
}): Promise<Category> {
  const name = params.name.trim();
  if (!name) {
    const err = new Error("Name is required") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const [existing] = await db
    .select()
    .from(productCategories)
    .where(
      and(
        eq(productCategories.businessId, params.businessId),
        eq(productCategories.id, params.id),
      ),
    )
    .limit(1);

  if (!existing) {
    const err = new Error("Category not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const [duplicate] = await db
    .select()
    .from(productCategories)
    .where(
      and(
        eq(productCategories.businessId, params.businessId),
        eq(productCategories.name, name),
      ),
    )
    .limit(1);

  if (duplicate && duplicate.id !== existing.id) {
    const err = new Error("Category name already exists") as Error & {
      status?: number;
    };
    err.status = 409;
    throw err;
  }

  const [updated] = await db
    .update(productCategories)
    .set({ name, updatedAt: new Date() })
    .where(
      and(
        eq(productCategories.businessId, params.businessId),
        eq(productCategories.id, params.id),
      ),
    )
    .returning();

  if (!updated) {
    const err = new Error("Failed to update category") as Error & { status?: number };
    err.status = 500;
    throw err;
  }

  return toCategory(updated);
}

export async function deleteCategory(params: {
  id: number;
  businessId: number;
}): Promise<void> {
  const [existing] = await db
    .select()
    .from(productCategories)
    .where(
      and(
        eq(productCategories.businessId, params.businessId),
        eq(productCategories.id, params.id),
      ),
    )
    .limit(1);

  if (!existing) {
    const err = new Error("Category not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const [inUse] = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.businessId, params.businessId),
        eq(products.category, existing.name),
      ),
    )
    .limit(1);

  if (inUse) {
    const err = new Error("Cannot delete category that is used by products") as Error & {
      status?: number;
    };
    err.status = 400;
    throw err;
  }

  await db
    .delete(productCategories)
    .where(
      and(
        eq(productCategories.businessId, params.businessId),
        eq(productCategories.id, params.id),
      ),
    )
    .returning({ id: productCategories.id });
}

