import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { branches } from "../db/schema/schema.js";

type DbBranch = typeof branches.$inferSelect;
type DbBranchInsert = typeof branches.$inferInsert;

export interface Branch {
  id: number;
  name: string;
  code: string | null;
  active: boolean;
}

function toBranch(row: DbBranch): Branch {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    active: row.isActive !== 0,
  };
}

export async function listBranches(params: {
  businessId: number;
}): Promise<Branch[]> {
  const { businessId } = params;

  const rows = await db
    .select()
    .from(branches)
    .where(eq(branches.businessId, businessId))
    .orderBy(branches.name);

  return rows.map(toBranch);
}

export async function createBranch(params: {
  businessId: number;
  name: string;
  code?: string | null;
}): Promise<Branch> {
  const { businessId, name, code } = params;

  const values: DbBranchInsert = {
    businessId,
    name: name.trim(),
    code: code?.trim() || null,
    isActive: 1,
  };

  const [row] = await db.insert(branches).values(values).returning();

  if (!row) {
    const err = new Error("Failed to create branch") as Error & { status?: number };
    err.status = 500;
    throw err;
  }

  return toBranch(row);
}

export async function updateBranch(params: {
  id: number;
  businessId: number;
  name?: string;
  code?: string | null;
  active?: boolean;
}): Promise<Branch> {
  const { id, businessId, name, code, active } = params;

  const [existing] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, id), eq(branches.businessId, businessId)))
    .limit(1);

  if (!existing) {
    const err = new Error("Branch not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const updateData: Partial<DbBranchInsert> = {};

  if (typeof name === "string") {
    updateData.name = name.trim();
  }
  if (typeof code === "string") {
    updateData.code = code.trim();
  }
  if (typeof active === "boolean") {
    updateData.isActive = active ? 1 : 0;
  }

  if (Object.keys(updateData).length === 0) {
    return toBranch(existing);
  }

  const [updated] = await db
    .update(branches)
    .set({
      ...updateData,
      updatedAt: new Date(),
    })
    .where(and(eq(branches.id, id), eq(branches.businessId, businessId)))
    .returning();

  if (!updated) {
    const err = new Error("Failed to update branch") as Error & { status?: number };
    err.status = 500;
    throw err;
  }

  return toBranch(updated);
}

export async function getBranchById(params: {
  id: number;
  businessId: number;
}): Promise<Branch | null> {
  const { id, businessId } = params;

  const [row] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, id), eq(branches.businessId, businessId)))
    .limit(1);

  if (!row) return null;

  return toBranch(row);
}

