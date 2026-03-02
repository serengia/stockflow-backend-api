import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { suppliers } from "../db/schema/schema.js";

type DbSupplier = typeof suppliers.$inferSelect;

export interface Supplier {
  id: number;
  businessId: number;
  name: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
}

function toSupplier(row: DbSupplier): Supplier {
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    contact: row.contactName ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
  };
}

export async function listSuppliers(params: {
  businessId: number;
}): Promise<Supplier[]> {
  const { businessId } = params;

  const rows = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.businessId, businessId))
    .orderBy(suppliers.name);

  return rows.map(toSupplier);
}

export async function createSupplier(params: {
  businessId: number;
  name: string;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<Supplier> {
  const { businessId, name, contact, email, phone } = params;

  const [created] = await db
    .insert(suppliers)
    .values({
      businessId,
      name: name.trim(),
      contactName: contact?.trim() || null,
      email: email?.trim() || null,
      phone: phone?.trim() || null,
    })
    .returning();

  if (!created) {
    const err = new Error("Failed to create supplier") as Error & { status?: number };
    err.status = 500;
    throw err;
  }

  return toSupplier(created);
}

export async function updateSupplier(params: {
  id: number;
  businessId: number;
  name?: string;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<Supplier> {
  const { id, businessId, name, contact, email, phone } = params;

  const [existing] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.businessId, businessId)))
    .limit(1);

  if (!existing) {
    const err = new Error("Supplier not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const updateData: Partial<DbSupplier> = {};
  if (typeof name === "string") updateData.name = name.trim();
  if (contact !== undefined) updateData.contactName = contact?.trim() || null;
  if (email !== undefined) updateData.email = email?.trim() || null;
  if (phone !== undefined) updateData.phone = phone?.trim() || null;

  let updatedRow = existing;

  if (Object.keys(updateData).length > 0) {
    const [updated] = await db
      .update(suppliers)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(and(eq(suppliers.id, id), eq(suppliers.businessId, businessId)))
      .returning();

    if (!updated) {
      const err = new Error("Failed to update supplier") as Error & { status?: number };
      err.status = 500;
      throw err;
    }

    updatedRow = updated;
  }

  return toSupplier(updatedRow);
}

export async function deleteSupplier(params: {
  id: number;
  businessId: number;
}): Promise<void> {
  const { id, businessId } = params;

  const result = await db
    .delete(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.businessId, businessId)))
    .returning({ id: suppliers.id });

  if (!result[0]) {
    const err = new Error("Supplier not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
}

