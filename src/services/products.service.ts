import { and, eq, desc, gte, ilike, or, sql, sum } from "drizzle-orm";
import { db } from "../db/index.js";
import { products, stockLevels, stockMovements, saleItems, sales } from "../db/schema/schema.js";
import { cloudinary } from "../lib/cloudinary.js";
import { allowsDecimal, type UnitType } from "../config/units.js";

type DbProduct = typeof products.$inferSelect;
type DbStockLevel = typeof stockLevels.$inferSelect;

function numericToNumber(val: string | number | null | undefined): number {
  if (val == null) return 0;
  return typeof val === "number" ? val : Number(val);
}

export interface InventoryProduct {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  unit: string;
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
    barcode: row.product.barcode ?? null,
    category: row.product.category ?? null,
    unit: row.product.unit ?? "piece",
    costPrice: row.product.costPrice,
    sellPrice: row.product.sellPrice,
    status: row.product.status,
    quantity: numericToNumber(row.stockLevel?.quantity),
    reorderLevel: row.product.reorderLevel ?? 10,
    imageUrl: row.product.imageUrl ?? null,
  };
}

export interface ListProductsResult {
  data: InventoryProduct[];
  total: number;
  page: number;
  limit: number;
}

export async function listProducts(params: {
  businessId: number;
  branchId?: number | null;
  search?: string;
  category?: string;
  page?: number;
  limit?: number;
}): Promise<ListProductsResult> {
  const { businessId, branchId, search, category } = params;
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(200, Math.max(1, params.limit ?? 200));

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

  const whereConditions = [eq(products.businessId, businessId)];

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    whereConditions.push(
      or(
        ilike(products.name, term),
        ilike(products.sku, term),
        ilike(products.barcode, term),
      )!,
    );
  }

  if (category && category.trim()) {
    whereConditions.push(eq(products.category, category.trim()));
  }

  const whereClause = and(...whereConditions);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(whereClause);
  const total = Number(countRow?.count ?? 0);

  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      product: products,
      stockLevel: stockLevels,
    })
    .from(products)
    .leftJoin(stockLevels, joinOn)
    .where(whereClause)
    .orderBy(products.name)
    .limit(limit)
    .offset(offset);

  return {
    data: rows.map(toInventoryProduct),
    total,
    page,
    limit,
  };
}

export interface ProductsSummary {
  total: number;
  belowReorderCount: number;
  totalStockValue: number;
}

export async function getProductsSummary(params: {
  businessId: number;
  branchId?: number | null;
}): Promise<ProductsSummary> {
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

  const whereClause = eq(products.businessId, businessId);

  const rows = await db
    .select({
      product: products,
      stockLevel: stockLevels,
    })
    .from(products)
    .leftJoin(stockLevels, joinOn)
    .where(whereClause);

  const seenProductIds = new Set<number>();
  const belowReorderProductIds = new Set<number>();
  let totalStockValue = 0;

  for (const row of rows) {
    const qty = numericToNumber(row.stockLevel?.quantity);
    const reorder = row.product.reorderLevel ?? 10;
    const cost = numericToNumber(row.product.costPrice);

    if (branchId != null) {
      seenProductIds.add(row.product.id);
      totalStockValue += cost * qty;
      if (qty < reorder) belowReorderProductIds.add(row.product.id);
    } else {
      seenProductIds.add(row.product.id);
      totalStockValue += cost * qty;
      if (qty < reorder) belowReorderProductIds.add(row.product.id);
    }
  }

  return {
    total: seenProductIds.size,
    belowReorderCount: belowReorderProductIds.size,
    totalStockValue: Math.round(totalStockValue * 100) / 100,
  };
}

const CATEGORY_ABBREVIATIONS: Record<string, string> = {
  "food & beverages": "FOD",
  "household & cleaning": "HOU",
  "personal care": "PER",
  "baby products": "BAB",
  "snacks & confectionery": "SNK",
  "cooking oil & fats": "OIL",
  dairy: "DAI",
  "bread & bakery": "BRD",
  stationery: "STA",
  "alcoholic beverages": "ALC",
  "soft drinks": "SDR",
  "cereals & grains": "CER",
  electrical: "ELE",
  plumbing: "PLU",
  "paint & finishes": "PNT",
  tools: "TOO",
  fasteners: "FAS",
  "building materials": "BLD",
  timber: "TIM",
  "safety & ppe": "SAF",
  "hair care": "HAI",
  "skin care": "SKN",
  makeup: "MKP",
  nails: "NAL",
  fragrances: "FRG",
  "wigs & extensions": "WIG",
  accessories: "ACC",
  prescription: "PRE",
  "otc pain & fever": "OTC",
  "cold & flu": "CLD",
  digestive: "DIG",
  "vitamins & supplements": "VIT",
  "first aid": "FAD",
  spirits: "SPI",
  beer: "BER",
  wine: "WIN",
  cigarettes: "CIG",
  other: "OTH",
  general: "GEN",
};

async function generateSku(
  businessId: number,
  category: string | null,
): Promise<string> {
  const catKey = (category ?? "").trim().toLowerCase();
  const prefix = CATEGORY_ABBREVIATIONS[catKey] ?? "SF";

  const [lastRow] = await db
    .select({ sku: products.sku })
    .from(products)
    .where(
      and(
        eq(products.businessId, businessId),
        ilike(products.sku, `${prefix}-%`),
      ),
    )
    .orderBy(desc(products.sku))
    .limit(1);

  let nextNum = 1;
  if (lastRow?.sku) {
    const parts = lastRow.sku.split("-");
    const num = parseInt(parts[parts.length - 1] ?? "0", 10);
    if (!isNaN(num)) nextNum = num + 1;
  }

  const padLen = prefix === "SF" ? 5 : 3;
  return `${prefix}-${String(nextNum).padStart(padLen, "0")}`;
}

export async function createProduct(params: {
  businessId: number;
  branchId?: number | null;
  userId: number;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  category?: string | null;
  unit?: string;
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
    barcode,
    category,
    unit = "piece",
    costPrice,
    sellPrice,
    quantity,
    reorderLevel,
  } = params;

  const reorderLevelValue =
    typeof reorderLevel === "number" && reorderLevel >= 0 ? reorderLevel : 10;

  const unitValue = unit || "piece";
  const isDecimalUnit = allowsDecimal(unitValue as UnitType);
  if (!isDecimalUnit && quantity !== Math.floor(quantity)) {
    const err = new Error(
      `Quantity must be a whole number for unit "${unitValue}"`,
    ) as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const resolvedSku = sku?.trim() || (await generateSku(businessId, category ?? null));

  const [product] = await db
    .insert(products)
    .values({
      businessId,
      name: name.trim(),
      sku: resolvedSku,
      barcode: barcode?.trim() || null,
      category: category?.trim() || null,
      unit: unitValue,
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
        quantity: initialQty.toString(),
      })
      .returning();
    stockLevel = level ?? null;
  }

  return {
    id: product.id,
    name: product.name,
    sku: product.sku ?? null,
    barcode: product.barcode ?? null,
    category: product.category ?? null,
    unit: product.unit ?? "piece",
    costPrice: product.costPrice,
    sellPrice: product.sellPrice,
    status: product.status,
    quantity: numericToNumber(stockLevel?.quantity),
    reorderLevel: product.reorderLevel ?? 10,
    imageUrl: product.imageUrl ?? null,
  };
}

export interface BulkProductRow {
  name: string;
  sku?: string | null;
  category?: string | null;
  unit?: string;
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
        unit: row.unit || "piece",
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
  const result = await listProducts({ businessId, branchId: branchId ?? null });
  return result.data.filter((p) => !p.category || p.category.trim() === "");
}

export async function listMissingSkuProducts(params: {
  businessId: number;
  branchId?: number | null;
}): Promise<InventoryProduct[]> {
  const { businessId, branchId } = params;
  const result = await listProducts({ businessId, branchId: branchId ?? null });
  return result.data.filter((p) => !p.sku || p.sku.trim() === "");
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
  barcode?: string | null;
  category?: string | null;
  unit?: string;
  costPrice?: number;
  sellPrice?: number;
  quantity?: number;
  status?: DbProduct["status"];
  reorderLevel?: number;
}): Promise<InventoryProduct> {
  const { id, businessId, branchId, name, sku, barcode, category, costPrice, sellPrice, quantity, status } =
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
  if (typeof barcode === "string") updateData.barcode = barcode.trim();
  if (typeof category === "string") updateData.category = category.trim();
  if (typeof params.unit === "string") updateData.unit = params.unit;
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
        .set({ quantity: quantity.toString() })
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
          quantity: quantity.toString(),
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
    barcode: updatedProduct.barcode ?? null,
    category: updatedProduct.category ?? null,
    unit: updatedProduct.unit ?? "piece",
    costPrice: updatedProduct.costPrice,
    sellPrice: updatedProduct.sellPrice,
    status: updatedProduct.status,
    quantity: numericToNumber(stockLevel?.quantity),
    reorderLevel: updatedProduct.reorderLevel ?? 10,
    imageUrl: updatedProduct.imageUrl ?? null,
  };
}

export type StockAdjustmentType = "purchase" | "adjustment" | "opening_balance";

export interface StockMovementRecord {
  id: number;
  type: string;
  quantity: number | string;
  note: string | null;
  createdAt: Date;
  userId: number;
}

export async function adjustStock(params: {
  productId: number;
  businessId: number;
  branchId: number;
  userId: number;
  type: StockAdjustmentType;
  quantityChange: number;
  note?: string | null;
}): Promise<InventoryProduct> {
  const { productId, businessId, branchId, userId, type, quantityChange, note } = params;

  const [existing] = await db
    .select({ product: products })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.businessId, businessId)))
    .limit(1);

  if (!existing) {
    const err = new Error("Product not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const [existingLevel] = await db
    .select()
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.businessId, businessId),
        eq(stockLevels.branchId, branchId),
        eq(stockLevels.productId, productId),
      ),
    )
    .limit(1);

  let newQuantity: number;

  if (existingLevel) {
    newQuantity = numericToNumber(existingLevel.quantity) + quantityChange;
    await db
      .update(stockLevels)
      .set({ quantity: newQuantity.toString(), updatedAt: new Date() })
      .where(eq(stockLevels.id, existingLevel.id));
  } else {
    newQuantity = Math.max(0, quantityChange);
    await db.insert(stockLevels).values({
      businessId,
      branchId,
      productId,
      quantity: newQuantity.toString(),
    });
  }

  await db.insert(stockMovements).values({
    businessId,
    branchId,
    productId,
    userId,
    type,
    quantity: quantityChange.toString(),
    note: note?.trim() || null,
  });

  return {
    id: existing.product.id,
    name: existing.product.name,
    sku: existing.product.sku ?? null,
    barcode: existing.product.barcode ?? null,
    category: existing.product.category ?? null,
    unit: existing.product.unit ?? "piece",
    costPrice: existing.product.costPrice,
    sellPrice: existing.product.sellPrice,
    status: existing.product.status,
    quantity: newQuantity,
    reorderLevel: existing.product.reorderLevel ?? 10,
    imageUrl: existing.product.imageUrl ?? null,
  };
}

export async function getStockMovements(params: {
  productId: number;
  businessId: number;
  branchId?: number | null;
  limit?: number;
}): Promise<StockMovementRecord[]> {
  const { productId, businessId, branchId } = params;
  const rowLimit = params.limit ?? 50;

  const conditions = [
    eq(stockMovements.productId, productId),
    eq(stockMovements.businessId, businessId),
  ];

  if (branchId != null) {
    conditions.push(eq(stockMovements.branchId, branchId));
  }

  const rows = await db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      note: stockMovements.note,
      createdAt: stockMovements.createdAt,
      userId: stockMovements.userId,
    })
    .from(stockMovements)
    .where(and(...conditions))
    .orderBy(desc(stockMovements.createdAt))
    .limit(rowLimit);

  return rows;
}

export async function getFrequentlySold(params: {
  businessId: number;
  branchId?: number | null;
  limit?: number;
  days?: number;
}): Promise<InventoryProduct[]> {
  const { businessId, branchId } = params;
  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  const days = Math.max(1, params.days ?? 30);

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);

  const salesConditions = [
    eq(sales.businessId, businessId),
    gte(sales.soldAt, sinceDate),
  ];
  if (branchId != null) {
    salesConditions.push(eq(sales.branchId, branchId));
  }

  const topProducts = await db
    .select({
      productId: saleItems.productId,
      totalSold: sum(saleItems.quantity).as("total_sold"),
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .where(and(...salesConditions))
    .groupBy(saleItems.productId)
    .orderBy(desc(sql`total_sold`))
    .limit(limit);

  if (topProducts.length === 0) return [];

  const productIds = topProducts.map((r) => r.productId);

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
    .select({ product: products, stockLevel: stockLevels })
    .from(products)
    .leftJoin(stockLevels, joinOn)
    .where(
      and(
        eq(products.businessId, businessId),
        sql`${products.id} = ANY(${productIds})`,
      ),
    );

  const productMap = new Map(rows.map((r) => [r.product.id, toInventoryProduct(r)]));

  return topProducts
    .map((r) => productMap.get(r.productId))
    .filter((p): p is InventoryProduct => p != null);
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

