import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { sales, saleItems, cashRegisterEntries, stockLevels, stockMovements, products } from "../db/schema/schema.js";

type DbSale = typeof sales.$inferSelect;

export interface CreateSaleItemInput {
  productId: number;
  quantity: number;
  unitPrice: number;
}

export interface CreateSaleParams {
  businessId: number;
  branchId: number;
  userId: number;
  items: CreateSaleItemInput[];
  totalAmount: number;
  paymentMethod: "cash" | "mpesa" | "bank_transfer" | "card" | "other";
  referenceCode?: string | null;
  offlineId?: string | null;
}

export interface CreatedSale {
  id: number;
  totalAmount: DbSale["totalAmount"];
  soldAt: DbSale["soldAt"];
}

export interface SaleItemForList {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface ListedSale {
  id: number;
  businessId: number;
  branchId: number;
  userId: number;
  date: DbSale["soldAt"];
  totalAmount: DbSale["totalAmount"];
  status: DbSale["status"];
  soldAt: DbSale["soldAt"];
  paymentMethod: typeof cashRegisterEntries.$inferSelect.paymentMethod | null;
  referenceCode: string | null;
  items: SaleItemForList[];
}

export async function createSale(params: CreateSaleParams): Promise<CreatedSale> {
  const {
    businessId,
    branchId,
    userId,
    items,
    totalAmount,
    paymentMethod,
    referenceCode,
    offlineId,
  } = params;

  if (!items.length) {
    const err = new Error("Sale must have at least one item") as Error & {
      status?: number;
    };
    err.status = 400;
    throw err;
  }

  const totalAmountStr = totalAmount.toFixed(2);

  return db.transaction(async (tx) => {
    const [saleRow] = await tx
      .insert(sales)
      .values({
        businessId,
        branchId,
        userId,
        totalAmount: totalAmountStr,
        status: "completed",
        offlineId: offlineId ?? null,
      })
      .returning();

    if (!saleRow) {
      const err = new Error("Failed to create sale") as Error & { status?: number };
      err.status = 500;
      throw err;
    }

    for (const item of items) {
      const lineTotal = item.quantity * item.unitPrice;
      const lineTotalStr = lineTotal.toFixed(2);

      await tx.insert(saleItems).values({
        saleId: saleRow.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        lineTotal: lineTotalStr,
      });

      const [existingLevel] = await tx
        .select()
        .from(stockLevels)
        .where(
          and(
            eq(stockLevels.businessId, businessId),
            eq(stockLevels.branchId, branchId),
            eq(stockLevels.productId, item.productId),
          ),
        )
        .limit(1);

      if (existingLevel) {
        await tx
          .update(stockLevels)
          .set({
            quantity: existingLevel.quantity - item.quantity,
            updatedAt: new Date(),
          })
          .where(eq(stockLevels.id, existingLevel.id));
      } else {
        await tx.insert(stockLevels).values({
          businessId,
          branchId,
          productId: item.productId,
          quantity: -item.quantity,
        });
      }

      await tx.insert(stockMovements).values({
        businessId,
        branchId,
        productId: item.productId,
        userId,
        type: "sale",
        quantity: item.quantity,
        note: "POS sale",
      });
    }

    await tx.insert(cashRegisterEntries).values({
      businessId,
      branchId,
      saleId: saleRow.id,
      paymentMethod,
      referenceCode: referenceCode ?? null,
      amount: totalAmountStr,
      recordedByUserId: userId,
    });

    return {
      id: saleRow.id,
      totalAmount: saleRow.totalAmount,
      soldAt: saleRow.soldAt,
    };
  });
}

export async function listSales(params: {
  businessId: number;
  branchId?: number | null;
  from?: Date;
  to?: Date;
}): Promise<ListedSale[]> {
  const { businessId, branchId, from, to } = params;

  const conditions = [eq(sales.businessId, businessId)];

  if (typeof branchId === "number") {
    conditions.push(eq(sales.branchId, branchId));
  }

  if (from) {
    conditions.push(gte(sales.soldAt, from));
  }

  if (to) {
    conditions.push(lte(sales.soldAt, to));
  }

  const whereClause = and(...conditions);

  const saleRows = await db
    .select()
    .from(sales)
    .where(whereClause)
    .orderBy(sales.soldAt);

  if (saleRows.length === 0) {
    return [];
  }

  const saleIds = saleRows.map((s) => s.id);

  const itemRows = await db
    .select({
      saleId: saleItems.saleId,
      productId: saleItems.productId,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      lineTotal: saleItems.lineTotal,
      productName: products.name,
    })
    .from(saleItems)
    .innerJoin(products, eq(saleItems.productId, products.id))
    .where(inArray(saleItems.saleId, saleIds));

  const paymentRows = await db
    .select({
      saleId: cashRegisterEntries.saleId,
      paymentMethod: cashRegisterEntries.paymentMethod,
      referenceCode: cashRegisterEntries.referenceCode,
    })
    .from(cashRegisterEntries)
    .where(inArray(cashRegisterEntries.saleId, saleIds));

  const itemsBySaleId = new Map<number, SaleItemForList[]>();
  for (const row of itemRows) {
    const list = itemsBySaleId.get(row.saleId) ?? [];
    list.push({
      productId: row.productId,
      productName: String(row.productName),
      quantity: row.quantity,
      unitPrice: Number(row.unitPrice),
      total: Number(row.lineTotal),
    });
    itemsBySaleId.set(row.saleId, list);
  }

  const paymentBySaleId = new Map<
    number,
    { paymentMethod: typeof cashRegisterEntries.$inferSelect.paymentMethod | null; referenceCode: string | null }
  >();
  for (const row of paymentRows) {
    if (!paymentBySaleId.has(row.saleId)) {
      paymentBySaleId.set(row.saleId, {
        paymentMethod: row.paymentMethod,
        referenceCode: row.referenceCode ?? null,
      });
    }
  }

  return saleRows.map((s) => {
    const payment = paymentBySaleId.get(s.id);
    return {
      id: s.id,
      businessId: s.businessId,
      branchId: s.branchId,
      userId: s.userId,
      date: s.soldAt,
      totalAmount: s.totalAmount,
      status: s.status,
      soldAt: s.soldAt,
      paymentMethod: payment?.paymentMethod ?? null,
      referenceCode: payment?.referenceCode ?? null,
      items: itemsBySaleId.get(s.id) ?? [],
    };
  });
}

