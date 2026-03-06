import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { products, stockLevels } from "../db/schema/schema.js";
import { cloudinary } from "../lib/cloudinary.js";

type DbProduct = typeof products.$inferSelect;
type DbStockLevel = typeof stockLevels.$inferSelect;

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
  imageUrl: string | null;
}

function toInventoryProduct(row: {
  product: DbProduct;
  stockLevel: DbStockLevel | null;
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
    reorderLevel: row.product.reorderLevel ?? 10,
    imageUrl: row.product.imageUrl ?? null,
  };
}

export async function listProducts(params: {
  businessId: number;
  branchId?: number | null;
}): Promise<InventoryProduct[]> {
  const { businessId, branchId } = params;

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
    })
    .from(products)
    .leftJoin(stockLevels, joinOn)
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
  quantity: number;
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

  const reorderLevelValue =
    typeof reorderLevel === "number" && reorderLevel >= 0 ? reorderLevel : 10;

  const [product] = await db
    .insert(products)
    .values({
      businessId,
      name: name.trim(),
      sku: sku?.trim() || null,
      category: category?.trim() || null,
      costPrice: costPrice.toString(),
      sellPrice: sellPrice.toString(),
      reorderLevel: reorderLevelValue,
      status: "active",
    })
    .returning();

  if (!product) {
    const err = new Error("Failed to create product") as Error & { status?: number };
    err.status = 500;
    throw err;
  }

  let stockLevel: DbStockLevel | null = null;
  const initialQty = typeof quantity === "number" && quantity >= 0 ? quantity : 0;

  if (branchId != null) {
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
    reorderLevel: product.reorderLevel ?? 10,
    imageUrl: product.imageUrl ?? null,
  };
}

export interface BulkProductRow {
  name: string;
  sku?: string | null;
  category?: string | null;
  costPrice: number;
  sellPrice: number;
  quantity: number;
  reorderLevel?: number;
}

export interface BulkCreateResult {
  created: number;
  errors: Array<{ row: number; message: string }>;
}

export interface OrganizeSummary {
  uncategorizedCount: number;
  missingSkuCount: number;
}

export interface BulkOrganizeResult {
  updated: number;
  errors: Array<{ id: number; message: string }>;
}

export async function bulkCreateProducts(params: {
  businessId: number;
  branchId?: number | null;
  userId: number;
  products: BulkProductRow[];
}): Promise<BulkCreateResult> {
  const { businessId, branchId, userId, products: rows } = params;
  const result: BulkCreateResult = { created: 0, errors: [] };

  // Preload existing product names so we can prevent accidental duplicates
  // when the same file is imported multiple times or contains repeated names.
  const existingNameRows = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.businessId, businessId));

  const existingNames = new Set(
    existingNameRows
      .map((p) => (p.name ?? "").trim().toLowerCase())
      .filter((n) => n.length > 0),
  );

  for (const [i, row] of rows.entries()) {
    const rowNum = i + 1;
    try {
      const rawName = String(row.name ?? "").trim();
      if (!rawName) {
        result.errors.push({ row: rowNum, message: "Name is required" });
        continue;
      }
      const nameKey = rawName.toLowerCase();
      if (existingNames.has(nameKey)) {
        result.errors.push({
          row: rowNum,
          message: "A product with this name already exists. Check if you imported this file before.",
        });
        continue;
      }
      const costPrice = Number(row.costPrice);
      const sellPrice = Number(row.sellPrice);
      if (!Number.isFinite(costPrice) || costPrice <= 0) {
        result.errors.push({ row: rowNum, message: "Cost price is required and must be greater than 0" });
        continue;
      }
      if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
        result.errors.push({ row: rowNum, message: "Sell price is required and must be greater than 0" });
        continue;
      }
      const quantity = Number(row.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) {
        result.errors.push({ row: rowNum, message: "Quantity is required and must be 0 or greater" });
        continue;
      }
      await createProduct({
        businessId,
        branchId: branchId ?? null,
        userId,
        name: rawName,
        sku: row.sku != null ? String(row.sku).trim() || null : null,
        category: row.category != null ? String(row.category).trim() || null : null,
        costPrice,
        sellPrice,
        quantity,
        ...(typeof row.reorderLevel === "number" && {
          reorderLevel: row.reorderLevel,
        }),
      });
      result.created += 1;
      existingNames.add(nameKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create product";
      result.errors.push({ row: rowNum, message });
    }
  }

  return result;
}

export async function getOrganizeSummary(params: {
  businessId: number;
}): Promise<OrganizeSummary> {
  const { businessId } = params;

  const rows = await db
    .select({
      category: products.category,
      sku: products.sku,
    })
    .from(products)
    .where(eq(products.businessId, businessId));

  let uncategorizedCount = 0;
  let missingSkuCount = 0;

  for (const row of rows) {
    const category = (row.category ?? "").trim();
    if (!category) {
      uncategorizedCount += 1;
    }
    const sku = (row.sku ?? "").trim();
    if (!sku) {
      missingSkuCount += 1;
    }
  }

  return { uncategorizedCount, missingSkuCount };
}

export async function listUncategorizedProducts(params: {
  businessId: number;
  branchId?: number | null;
}): Promise<InventoryProduct[]> {
  const { businessId, branchId } = params;
  const items = await listProducts({ businessId, branchId: branchId ?? null });
  return items.filter((p) => !p.category || p.category.trim() === "");
}

export async function listMissingSkuProducts(params: {
  businessId: number;
  branchId?: number | null;
}): Promise<InventoryProduct[]> {
  const { businessId, branchId } = params;
  const items = await listProducts({ businessId, branchId: branchId ?? null });
  return items.filter((p) => !p.sku || p.sku.trim() === "");
}

export async function bulkUpdateCategories(params: {
  businessId: number;
  branchId?: number | null;
  userId: number;
  productIds: number[];
  category: string;
}): Promise<BulkOrganizeResult> {
  const { businessId, branchId, userId, productIds, category } = params;
  const result: BulkOrganizeResult = { updated: 0, errors: [] };
  const trimmedCategory = category.trim();

  for (const id of productIds) {
    try {
      await updateProduct({
        id,
        businessId,
        branchId: branchId ?? null,
        userId,
        category: trimmedCategory,
      });
      result.updated += 1;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update category";
      result.errors.push({ id, message });
    }
  }

  return result;
}

export async function bulkUpdateSkus(params: {
  businessId: number;
  branchId?: number | null;
  userId: number;
  items: Array<{ productId: number; sku: string }>;
}): Promise<BulkOrganizeResult> {
  const { businessId, branchId, userId, items } = params;
  const result: BulkOrganizeResult = { updated: 0, errors: [] };

  for (const { productId, sku } of items) {
    const normalizedSku = sku.trim().toUpperCase();
    if (!normalizedSku) {
      result.errors.push({
        id: productId,
        message: "SKU cannot be empty",
      });
      continue;
    }

    try {
      await updateProduct({
        id: productId,
        businessId,
        branchId: branchId ?? null,
        userId,
        sku: normalizedSku,
      });
      result.updated += 1;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update SKU";
      result.errors.push({ id: productId, message });
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
  if (typeof params.reorderLevel === "number" && params.reorderLevel >= 0)
    updateData.reorderLevel = params.reorderLevel;
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
    reorderLevel: updatedProduct.reorderLevel ?? 10,
    imageUrl: updatedProduct.imageUrl ?? null,
  };
}

export async function deleteProduct(params: {
  id: number;
  businessId: number;
}): Promise<void> {
  const { id, businessId } = params;

  const [existing] = await db
    .select({
      id: products.id,
      imagePublicId: products.imagePublicId,
    })
    .from(products)
    .where(and(eq(products.id, id), eq(products.businessId, businessId)))
    .limit(1);

  if (!existing) {
    const err = new Error("Product not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  if (existing.imagePublicId) {
    try {
      await cloudinary.uploader.destroy(existing.imagePublicId, {
        resource_type: "image",
      });
    } catch (err) {
      console.error(
        "[products] Failed to delete product image from Cloudinary:",
        err,
      );
      // Continue with product deletion even if image deletion fails
    }
  }

  await db
    .delete(products)
    .where(and(eq(products.id, id), eq(products.businessId, businessId)));
}

