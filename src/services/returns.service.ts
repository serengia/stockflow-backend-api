import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  sales,
  saleItems,
  products,
  returns,
  returnItems,
  stockLevels,
  stockMovements,
} from "../db/schema/schema.js";

type DbSale = typeof sales.$inferSelect;
type DbReturn = typeof returns.$inferSelect;

export interface CreateReturnItemInput {
  productId: number;
  quantity: number;
}

export interface CreateReturnParams {
  businessId: number;
  branchId: number | null;
  userId: number;
  saleId: number;
  items: CreateReturnItemInput[];
  reason?: string;
  refundMethod?: "cash" | "mpesa" | "bank_transfer" | "card" | "other";
  referenceCode?: string | null;
}

export interface ReturnItemForList {
  productId: number;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface ListedReturn {
  id: number;
  saleId: number;
  businessId: number;
  branchId: number;
  userId: number;
  date: DbReturn["createdAt"];
  totalAmount: DbReturn["totalAmount"];
  reason: string | null;
  paymentMethod: DbReturn["refundMethod"];
  referenceCode: string | null;
  items: ReturnItemForList[];
}

function toListedReturn(row: DbReturn, items: ReturnItemForList[]): ListedReturn {
  return {
    id: row.id,
    saleId: row.saleId,
    businessId: row.businessId,
    branchId: row.branchId,
    userId: row.userId,
    date: row.createdAt,
    totalAmount: row.totalAmount,
    reason: row.reason ?? null,
    paymentMethod: row.refundMethod ?? null,
    referenceCode: row.referenceCode ?? null,
    items,
  };
}

export async function createReturn(params: CreateReturnParams): Promise<ListedReturn> {
  const { businessId, branchId, userId, saleId, items, reason, refundMethod, referenceCode } =
    params;

  if (!items.length) {
    const err = new Error("Return must have at least one item") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const [saleRow] = await db
    .select()
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.businessId, businessId)))
    .limit(1);

  if (!saleRow) {
    const err = new Error("Sale not found for this business") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  if (branchId != null && saleRow.branchId !== branchId) {
    const err = new Error("Sale does not belong to the current branch") as Error & {
      status?: number;
    };
    err.status = 400;
    throw err;
  }

  const saleItemsRows = await db
    .select({
      productId: saleItems.productId,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
    })
    .from(saleItems)
    .where(eq(saleItems.saleId, saleId));

  if (!saleItemsRows.length) {
    const err = new Error("Sale has no line items") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const saleItemByProductId = new Map<
    number,
    { quantity: number; unitPrice: number }
  >();
  for (const row of saleItemsRows) {
    saleItemByProductId.set(row.productId, {
      quantity: row.quantity,
      unitPrice: Number(row.unitPrice),
    });
  }

  const existingReturnItemRows = await db
    .select({
      productId: returnItems.productId,
      quantity: returnItems.quantity,
    })
    .from(returnItems)
    .innerJoin(returns, eq(returnItems.returnId, returns.id))
    .where(and(eq(returns.saleId, saleId), eq(returns.businessId, businessId)));

  const alreadyReturnedByProductId = new Map<number, number>();
  for (const row of existingReturnItemRows) {
    const prev = alreadyReturnedByProductId.get(row.productId) ?? 0;
    alreadyReturnedByProductId.set(row.productId, prev + row.quantity);
  }

  const validatedItems: {
    productId: number;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[] = [];

  for (const item of items) {
    const base = saleItemByProductId.get(item.productId);
    if (!base) {
      const err = new Error(
        `Product ${item.productId} is not part of the original sale`,
      ) as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    const requestedQty = Math.floor(item.quantity);
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
      const err = new Error(
        `Invalid quantity for product ${item.productId}`,
      ) as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    const alreadyReturned = alreadyReturnedByProductId.get(item.productId) ?? 0;
    const maxAvailable = base.quantity - alreadyReturned;
    if (maxAvailable <= 0) {
      const err = new Error(
        `All units of product ${item.productId} have already been returned`,
      ) as Error & { status?: number };
      err.status = 400;
      throw err;
    }
    if (requestedQty > maxAvailable) {
      const err = new Error(
        `Cannot return ${requestedQty} units of product ${item.productId}; only ${maxAvailable} remaining from the original sale`,
      ) as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    const unitPrice = base.unitPrice;
    const lineTotal = unitPrice * requestedQty;
    validatedItems.push({
      productId: item.productId,
      quantity: requestedQty,
      unitPrice,
      lineTotal,
    });
  }

  const totalAmount = validatedItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const totalAmountStr = totalAmount.toFixed(2);

  const branchIdForReturn = saleRow.branchId;

  const result = await db.transaction(async (tx) => {
    const [createdReturn] = await tx
      .insert(returns)
      .values({
        businessId,
        branchId: branchIdForReturn,
        saleId,
        userId,
        totalAmount: totalAmountStr,
        reason: reason?.trim() || null,
        refundMethod: refundMethod ?? null,
        referenceCode: referenceCode?.trim() || null,
      })
      .returning();

    if (!createdReturn) {
      const err = new Error("Failed to create return") as Error & { status?: number };
      err.status = 500;
      throw err;
    }

    const itemsForList: ReturnItemForList[] = [];

    for (const item of validatedItems) {
      const lineTotalStr = item.lineTotal.toFixed(2);

      await tx.insert(returnItems).values({
        returnId: createdReturn.id,
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
            eq(stockLevels.branchId, branchIdForReturn),
            eq(stockLevels.productId, item.productId),
          ),
        )
        .limit(1);

      if (existingLevel) {
        await tx
          .update(stockLevels)
          .set({
            quantity: existingLevel.quantity + item.quantity,
            updatedAt: new Date(),
          })
          .where(eq(stockLevels.id, existingLevel.id));
      } else {
        await tx.insert(stockLevels).values({
          businessId,
          branchId: branchIdForReturn,
          productId: item.productId,
          quantity: item.quantity,
        });
      }

      await tx.insert(stockMovements).values({
        businessId,
        branchId: branchIdForReturn,
        productId: item.productId,
        userId,
        type: "return",
        quantity: item.quantity,
        note: reason ? `Return for sale ${saleId}: ${reason}` : `Return for sale ${saleId}`,
      });

      itemsForList.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.lineTotal,
      });
    }

    return toListedReturn(createdReturn, itemsForList);
  });

  return result;
}

export async function listReturns(params: {
  businessId: number;
  branchId?: number | null;
  saleId?: number;
  from?: Date;
  to?: Date;
}): Promise<ListedReturn[]> {
  const { businessId, branchId, saleId, from, to } = params;

  const conditions = [eq(returns.businessId, businessId)];

  if (typeof branchId === "number") {
    conditions.push(eq(returns.branchId, branchId));
  }

  if (typeof saleId === "number") {
    conditions.push(eq(returns.saleId, saleId));
  }

  if (from) {
    conditions.push(gte(returns.createdAt, from));
  }

  if (to) {
    conditions.push(lte(returns.createdAt, to));
  }

  const whereClause = and(...conditions);

  const returnRows = await db
    .select()
    .from(returns)
    .where(whereClause)
    .orderBy(returns.createdAt);

  if (!returnRows.length) {
    return [];
  }

  const returnIds = returnRows.map((r) => r.id);

  const itemRows = await db
    .select({
      returnId: returnItems.returnId,
      productId: returnItems.productId,
      quantity: returnItems.quantity,
      unitPrice: returnItems.unitPrice,
      lineTotal: returnItems.lineTotal,
    })
    .from(returnItems)
    .where(inArray(returnItems.returnId, returnIds));

  const itemsByReturnId = new Map<number, ReturnItemForList[]>();
  for (const row of itemRows) {
    const list = itemsByReturnId.get(row.returnId) ?? [];
    list.push({
      productId: row.productId,
      quantity: row.quantity,
      unitPrice: Number(row.unitPrice),
      total: Number(row.lineTotal),
    });
    itemsByReturnId.set(row.returnId, list);
  }

  return returnRows.map((r) => toListedReturn(r, itemsByReturnId.get(r.id) ?? []));
}

export async function getReturnById(params: {
  id: number;
  businessId: number;
}): Promise<ListedReturn | null> {
  const { id, businessId } = params;

  const [row] = await db
    .select()
    .from(returns)
    .where(and(eq(returns.id, id), eq(returns.businessId, businessId)))
    .limit(1);

  if (!row) return null;

  const itemRows = await db
    .select({
      productId: returnItems.productId,
      quantity: returnItems.quantity,
      unitPrice: returnItems.unitPrice,
      lineTotal: returnItems.lineTotal,
    })
    .from(returnItems)
    .where(eq(returnItems.returnId, row.id));

  const items: ReturnItemForList[] = itemRows.map((r) => ({
    productId: r.productId,
    quantity: r.quantity,
    unitPrice: Number(r.unitPrice),
    total: Number(r.lineTotal),
  }));

  return toListedReturn(row, items);
}

