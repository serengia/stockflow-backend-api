import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  sales,
  saleItems,
  cashRegisterEntries,
  stockLevels,
  stockMovements,
} from "../db/schema/schema.js";

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

