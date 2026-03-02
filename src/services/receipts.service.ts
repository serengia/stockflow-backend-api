import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { sales } from "../db/schema/schema.js";

type DbSale = typeof sales.$inferSelect;

export interface Receipt {
  id: number;
  saleId: number;
  businessId: number;
  branchId: number;
  date: DbSale["soldAt"];
  totalAmount: DbSale["totalAmount"];
}

function toReceipt(row: DbSale): Receipt {
  return {
    id: row.id,
    saleId: row.id,
    businessId: row.businessId,
    branchId: row.branchId,
    date: row.soldAt,
    totalAmount: row.totalAmount,
  };
}

export async function listReceipts(params: {
  businessId: number;
  branchId?: number | null;
}): Promise<Receipt[]> {
  const { businessId, branchId } = params;

  const conditions = [eq(sales.businessId, businessId)];

  if (typeof branchId === "number") {
    conditions.push(eq(sales.branchId, branchId));
  }

  const rows = await db
    .select()
    .from(sales)
    .where(and(...conditions))
    .orderBy(sales.soldAt);

  return rows.map(toReceipt);
}

