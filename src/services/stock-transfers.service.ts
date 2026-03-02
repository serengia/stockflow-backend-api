import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  branches,
  products,
  stockLevels,
  stockMovements,
  stockTransfers,
  stockTransferItems,
} from "../db/schema/schema.js";

type DbStockTransfer = typeof stockTransfers.$inferSelect;

export interface CreateStockTransferItemInput {
  productId: number;
  quantity: number;
}

export interface CreateStockTransferParams {
  businessId: number;
  userId: number;
  fromBranchId: number;
  toBranchId: number;
  items: CreateStockTransferItemInput[];
}

export interface StockTransferItemForList {
  productId: number;
  productName: string;
  quantity: number;
}

export interface ListedStockTransfer {
  id: number;
  businessId: number;
  fromBranchId: number;
  fromBranchName: string | null;
  toBranchId: number;
  toBranchName: string | null;
  status: string;
  date: DbStockTransfer["createdAt"];
  items: StockTransferItemForList[];
}

function toListedTransfer(
  row: DbStockTransfer,
  branchNames: Map<number, string>,
  items: StockTransferItemForList[],
): ListedStockTransfer {
  return {
    id: row.id,
    businessId: row.businessId,
    fromBranchId: row.fromBranchId,
    fromBranchName: branchNames.get(row.fromBranchId) ?? null,
    toBranchId: row.toBranchId,
    toBranchName: branchNames.get(row.toBranchId) ?? null,
    status: row.status,
    date: row.createdAt,
    items,
  };
}

export async function createStockTransfer(
  params: CreateStockTransferParams,
): Promise<ListedStockTransfer> {
  const { businessId, userId, fromBranchId, toBranchId, items } = params;

  if (!items.length) {
    const err = new Error("Transfer must have at least one item") as Error & {
      status?: number;
    };
    err.status = 400;
    throw err;
  }

  if (fromBranchId === toBranchId) {
    const err = new Error("From and to branches must be different") as Error & {
      status?: number;
    };
    err.status = 400;
    throw err;
  }

  const [fromBranch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, fromBranchId), eq(branches.businessId, businessId)))
    .limit(1);
  const [toBranch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, toBranchId), eq(branches.businessId, businessId)))
    .limit(1);

  if (!fromBranch || !toBranch) {
    const err = new Error("Branches not found for this business") as Error & {
      status?: number;
    };
    err.status = 400;
    throw err;
  }

  const productIds = [...new Set(items.map((i) => i.productId))];

  const productRows = await db
    .select({
      id: products.id,
      businessId: products.businessId,
      name: products.name,
    })
    .from(products)
    .where(inArray(products.id, productIds));

  const productById = new Map<number, { businessId: number; name: string }>();
  for (const p of productRows) {
    productById.set(p.id, { businessId: p.businessId, name: String(p.name) });
  }

  for (const item of items) {
    const product = productById.get(item.productId);
    if (!product || product.businessId !== businessId) {
      const err = new Error(
        `Product ${item.productId} not found for this business`,
      ) as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    const qty = Math.floor(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      const err = new Error(`Invalid quantity for product ${item.productId}`) as
        Error & { status?: number };
      err.status = 400;
      throw err;
    }
  }

  const result = await db.transaction(async (tx) => {
    const [createdTransfer] = await tx
      .insert(stockTransfers)
      .values({
        businessId,
        fromBranchId,
        toBranchId,
        createdByUserId: userId,
        status: "pending",
      })
      .returning();

    if (!createdTransfer) {
      const err = new Error("Failed to create stock transfer") as Error & {
        status?: number;
      };
      err.status = 500;
      throw err;
    }

    const branchNames = new Map<number, string>();
    branchNames.set(fromBranch.id, fromBranch.name);
    branchNames.set(toBranch.id, toBranch.name);

    const itemsForList: StockTransferItemForList[] = [];

    for (const item of items) {
      const qty = Math.floor(item.quantity);
      const product = productById.get(item.productId)!;

      const [fromLevel] = await tx
        .select()
        .from(stockLevels)
        .where(
          and(
            eq(stockLevels.businessId, businessId),
            eq(stockLevels.branchId, fromBranchId),
            eq(stockLevels.productId, item.productId),
          ),
        )
        .limit(1);

      const fromQty = fromLevel?.quantity ?? 0;
      if (fromQty < qty) {
        const err = new Error(
          `Insufficient stock for product ${item.productId} in branch ${fromBranchId}`,
        ) as Error & { status?: number };
        err.status = 400;
        throw err;
      }

      if (fromLevel) {
        await tx
          .update(stockLevels)
          .set({
            quantity: fromLevel.quantity - qty,
            updatedAt: new Date(),
          })
          .where(eq(stockLevels.id, fromLevel.id));
      }

      const [toLevel] = await tx
        .select()
        .from(stockLevels)
        .where(
          and(
            eq(stockLevels.businessId, businessId),
            eq(stockLevels.branchId, toBranchId),
            eq(stockLevels.productId, item.productId),
          ),
        )
        .limit(1);

      if (toLevel) {
        await tx
          .update(stockLevels)
          .set({
            quantity: toLevel.quantity + qty,
            updatedAt: new Date(),
          })
          .where(eq(stockLevels.id, toLevel.id));
      } else {
        await tx.insert(stockLevels).values({
          businessId,
          branchId: toBranchId,
          productId: item.productId,
          quantity: qty,
        });
      }

      await tx.insert(stockTransferItems).values({
        transferId: createdTransfer.id,
        productId: item.productId,
        quantity: qty,
      });

      await tx.insert(stockMovements).values({
        businessId,
        branchId: fromBranchId,
        productId: item.productId,
        userId,
        type: "adjustment",
        quantity: qty,
        note: `Stock transfer out to branch ${toBranchId} (transfer ${createdTransfer.id})`,
      });

      await tx.insert(stockMovements).values({
        businessId,
        branchId: toBranchId,
        productId: item.productId,
        userId,
        type: "adjustment",
        quantity: qty,
        note: `Stock transfer in from branch ${fromBranchId} (transfer ${createdTransfer.id})`,
      });

      itemsForList.push({
        productId: item.productId,
        productName: product.name,
        quantity: qty,
      });
    }

    return toListedTransfer(createdTransfer, branchNames, itemsForList);
  });

  return result;
}

export async function listStockTransfers(params: {
  businessId: number;
  branchId?: number | null;
}): Promise<ListedStockTransfer[]> {
  const { businessId, branchId } = params;

  const transferRows = await db
    .select()
    .from(stockTransfers)
    .where(
      typeof branchId === "number"
        ? and(
            eq(stockTransfers.businessId, businessId),
            or(
              eq(stockTransfers.fromBranchId, branchId),
              eq(stockTransfers.toBranchId, branchId),
            ),
          )
        : eq(stockTransfers.businessId, businessId),
    )
    .orderBy(stockTransfers.createdAt);

  if (!transferRows.length) {
    return [];
  }

  const transferIds = transferRows.map((t) => t.id);

  const itemRows = await db
    .select({
      transferId: stockTransferItems.transferId,
      productId: stockTransferItems.productId,
      quantity: stockTransferItems.quantity,
      productName: products.name,
    })
    .from(stockTransferItems)
    .innerJoin(products, eq(stockTransferItems.productId, products.id))
    .where(inArray(stockTransferItems.transferId, transferIds));

  const itemsByTransferId = new Map<number, StockTransferItemForList[]>();
  for (const row of itemRows) {
    const list = itemsByTransferId.get(row.transferId) ?? [];
    list.push({
      productId: row.productId,
      productName: String(row.productName),
      quantity: row.quantity,
    });
    itemsByTransferId.set(row.transferId, list);
  }

  const branchIds = [
    ...new Set(
      transferRows.flatMap((t) => [t.fromBranchId, t.toBranchId]),
    ),
  ];

  const branchRows = await db
    .select({
      id: branches.id,
      name: branches.name,
    })
    .from(branches)
    .where(inArray(branches.id, branchIds));

  const branchNames = new Map<number, string>();
  for (const b of branchRows) {
    branchNames.set(b.id, b.name);
  }

  return transferRows.map((t) =>
    toListedTransfer(t, branchNames, itemsByTransferId.get(t.id) ?? []),
  );
}

export async function getStockTransferById(params: {
  id: number;
  businessId: number;
}): Promise<ListedStockTransfer | null> {
  const { id, businessId } = params;

  const [row] = await db
    .select()
    .from(stockTransfers)
    .where(and(eq(stockTransfers.id, id), eq(stockTransfers.businessId, businessId)))
    .limit(1);

  if (!row) return null;

  const [fromBranch, toBranch] = await Promise.all([
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.id, row.fromBranchId))
      .limit(1),
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.id, row.toBranchId))
      .limit(1),
  ]).then(([fromArr, toArr]) => [fromArr[0], toArr[0]]);

  const branchNames = new Map<number, string>();
  if (fromBranch) branchNames.set(fromBranch.id, fromBranch.name);
  if (toBranch) branchNames.set(toBranch.id, toBranch.name);

  const itemRows = await db
    .select({
      productId: stockTransferItems.productId,
      quantity: stockTransferItems.quantity,
      productName: products.name,
    })
    .from(stockTransferItems)
    .innerJoin(products, eq(stockTransferItems.productId, products.id))
    .where(eq(stockTransferItems.transferId, row.id));

  const items: StockTransferItemForList[] = itemRows.map((r) => ({
    productId: r.productId,
    productName: String(r.productName),
    quantity: r.quantity,
  }));

  return toListedTransfer(row, branchNames, items);
}

export async function updateStockTransferStatus(params: {
  id: number;
  businessId: number;
  status: "pending" | "in-transit" | "received";
}): Promise<ListedStockTransfer> {
  const { id, businessId, status } = params;

  const [updated] = await db
    .update(stockTransfers)
    .set({ status })
    .where(and(eq(stockTransfers.id, id), eq(stockTransfers.businessId, businessId)))
    .returning();

  if (!updated) {
    const err = new Error("Stock transfer not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const [transfer] = await listStockTransfers({
    businessId,
  }).then((list) => list.filter((t) => t.id === id));

  if (!transfer) {
    const err = new Error("Failed to load updated transfer") as Error & {
      status?: number;
    };
    err.status = 500;
    throw err;
  }

  return transfer;
}

