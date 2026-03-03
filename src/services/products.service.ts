import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { products, stockLevels, productSkus } from "../db/schema/schema.js";

type DbProduct = typeof products.$inferSelect;
type DbStockLevel = typeof stockLevels.$inferSelect;
type DbSku = typeof productSkus.$inferSelect;

export interface InventoryProduct {
  id: number;
  name: string;
  sku: string | null;
  category: string | null;
  costPrice: DbProduct["costPrice"];
  sellPrice: DbProduct["sellPrice"];
  status: DbProduct["status"];
  quantity: number;
  reorderLevel: number;
}

function toInventoryProduct(row: {
  product: DbProduct;
  stockLevel: DbStockLevel | null;
  sku: DbSku | null;
}): InventoryProduct {
  return {
    id: row.product.id,
    name: row.product.name,
    sku: row.product.sku ?? null,
    category: row.product.category ?? null,
    costPrice: row.product.costPrice,
    sellPrice: row.product.sellPrice,
    status: row.product.status,
    quantity: row.stockLevel?.quantity ?? 0,
    reorderLevel: row.sku?.reorderLevel ?? 10,
  };
}

export async function listProducts(params: {
  businessId: number;
  branchId?: number | null;
}): Promise<InventoryProduct[]> {
  const { businessId, branchId } = params;

  const skuJoinOn = and(
    eq(productSkus.businessId, products.businessId),
    eq(productSkus.code, products.sku),
  );

  const joinOn =
    branchId != null
      ? and(
          eq(stockLevels.productId, products.id),
          eq(stockLevels.businessId, businessId),
          eq(stockLevels.branchId, branchId),
        )
      : and(
          eq(stockLevels.productId, products.id),
          eq(stockLevels.businessId, businessId),
        );

  const rows = await db
    .select({
      product: products,
      stockLevel: stockLevels,
      sku: productSkus,
    })
    .from(products)
    .leftJoin(stockLevels, joinOn)
    .leftJoin(productSkus, skuJoinOn)
    .where(eq(products.businessId, businessId))
    .orderBy(products.name);

  return rows.map(toInventoryProduct);
}

export async function createProduct(params: {
  businessId: number;
  branchId?: number | null;
  userId: number;
  name: string;
  sku?: string | null;
  category?: string | null;
  costPrice: number;
  sellPrice: number;
  quantity?: number;
  reorderLevel?: number;
}): Promise<InventoryProduct> {
  const {
    businessId,
    branchId,
    userId: _userId,
    name,
    sku,
    category,
    costPrice,
    sellPrice,
    quantity,
    reorderLevel,
  } = params;

  const [product] = await db
    .insert(products)
    .values({
      businessId,
      name: name.trim(),
      sku: sku?.trim() || null,
      category: category?.trim() || null,
      costPrice: costPrice.toString(),
      sellPrice: sellPrice.toString(),
      status: "active",
    })
    .returning();

  if (!product) {
    const err = new Error("Failed to create product") as Error & { status?: number };
    err.status = 500;
    throw err;
  }

  let stockLevel: DbStockLevel | null = null;
  const initialQty = typeof quantity === "number" && quantity > 0 ? quantity : 0;

  if (branchId != null && initialQty > 0) {
    const [level] = await db
      .insert(stockLevels)
      .values({
        businessId,
        branchId,
        productId: product.id,
        quantity: initialQty,
      })
      .returning();
    stockLevel = level ?? null;
  }

  return {
    id: product.id,
    name: product.name,
    sku: product.sku ?? null,
    category: product.category ?? null,
    costPrice: product.costPrice,
    sellPrice: product.sellPrice,
    status: product.status,
    quantity: stockLevel?.quantity ?? 0,
    reorderLevel: typeof reorderLevel === "number" ? reorderLevel : 10,
  };
}

export interface BulkProductRow {
  name: string;
  sku?: string | null;
  category?: string | null;
  costPrice: number;
  sellPrice: number;
  quantity?: number;
  reorderLevel?: number;
}

export interface BulkCreateResult {
  created: number;
  errors: Array<{ row: number; message: string }>;
}

export async function bulkCreateProducts(params: {
  businessId: number;
  branchId?: number | null;
  userId: number;
  products: BulkProductRow[];
}): Promise<BulkCreateResult> {
  const { businessId, branchId, userId, products: rows } = params;
  const result: BulkCreateResult = { created: 0, errors: [] };

  for (const [i, row] of rows.entries()) {
    const rowNum = i + 1;
    try {
      if (!row.name || String(row.name).trim() === "") {
        result.errors.push({ row: rowNum, message: "Name is required" });
        continue;
      }
      const costPrice = Number(row.costPrice);
      const sellPrice = Number(row.sellPrice);
      if (!Number.isFinite(costPrice) || costPrice < 0) {
        result.errors.push({ row: rowNum, message: "Invalid cost price" });
        continue;
      }
      if (!Number.isFinite(sellPrice) || sellPrice < 0) {
        result.errors.push({ row: rowNum, message: "Invalid sell price" });
        continue;
      }
      await createProduct({
        businessId,
        branchId: branchId ?? null,
        userId,
        name: String(row.name).trim(),
        sku: row.sku != null ? String(row.sku).trim() || null : null,
        category: row.category != null ? String(row.category).trim() || null : null,
        costPrice,
        sellPrice,
        ...(typeof row.quantity === "number" && { quantity: row.quantity }),
        ...(typeof row.reorderLevel === "number" && {
          reorderLevel: row.reorderLevel,
        }),
      });
      result.created += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create product";
      result.errors.push({ row: rowNum, message });
    }
  }

  return result;
}

export async function updateProduct(params: {
  id: number;
  businessId: number;
  branchId?: number | null;
  userId: number;
  name?: string;
  sku?: string | null;
  category?: string | null;
  costPrice?: number;
  sellPrice?: number;
  quantity?: number;
  status?: DbProduct["status"];
  reorderLevel?: number;
}): Promise<InventoryProduct> {
  const { id, businessId, branchId, name, sku, category, costPrice, sellPrice, quantity, status } =
    params;

  const [existing] = await db
    .select({
      product: products,
    })
    .from(products)
    .where(and(eq(products.id, id), eq(products.businessId, businessId)))
    .limit(1);

  if (!existing) {
    const err = new Error("Product not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const updateData: Partial<DbProduct> = {};
  if (typeof name === "string") updateData.name = name.trim();
  if (typeof sku === "string") updateData.sku = sku.trim();
  if (typeof category === "string") updateData.category = category.trim();
  if (typeof costPrice === "number") updateData.costPrice = costPrice.toString();
  if (typeof sellPrice === "number") updateData.sellPrice = sellPrice.toString();
  if (status) updateData.status = status;

  let updatedProduct = existing.product;

  if (Object.keys(updateData).length > 0) {
    const [updated] = await db
      .update(products)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(and(eq(products.id, id), eq(products.businessId, businessId)))
      .returning();

    if (!updated) {
      const err = new Error("Failed to update product") as Error & { status?: number };
      err.status = 500;
      throw err;
    }
    updatedProduct = updated;
  }

  let stockLevel: DbStockLevel | null = null;

  if (branchId != null && typeof quantity === "number") {
    const [existingLevel] = await db
      .select()
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.businessId, businessId),
          eq(stockLevels.branchId, branchId),
          eq(stockLevels.productId, id),
        ),
      )
      .limit(1);

    if (existingLevel) {
      const [updatedLevel] = await db
        .update(stockLevels)
        .set({ quantity })
        .where(eq(stockLevels.id, existingLevel.id))
        .returning();
      stockLevel = updatedLevel ?? existingLevel;
    } else {
      const [createdLevel] = await db
        .insert(stockLevels)
        .values({
          businessId,
          branchId,
          productId: id,
          quantity,
        })
        .returning();
      stockLevel = createdLevel ?? null;
    }
  } else if (branchId != null) {
    const [existingLevel] = await db
      .select()
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.businessId, businessId),
          eq(stockLevels.branchId, branchId),
          eq(stockLevels.productId, id),
        ),
      )
      .limit(1);
    stockLevel = existingLevel ?? null;
  }

  return {
    id: updatedProduct.id,
    name: updatedProduct.name,
    sku: updatedProduct.sku ?? null,
    category: updatedProduct.category ?? null,
    costPrice: updatedProduct.costPrice,
    sellPrice: updatedProduct.sellPrice,
    status: updatedProduct.status,
    quantity: stockLevel?.quantity ?? 0,
    reorderLevel: typeof params.reorderLevel === "number" ? params.reorderLevel : 10,
  };
}

export async function deleteProduct(params: {
  id: number;
  businessId: number;
}): Promise<void> {
  const { id, businessId } = params;

  const result = await db
    .delete(products)
    .where(and(eq(products.id, id), eq(products.businessId, businessId)))
    .returning({ id: products.id });

  if (!result[0]) {
    const err = new Error("Product not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
}

