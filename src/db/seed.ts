import { and, eq } from "drizzle-orm";
import { db } from "./index.js";
import {
  businesses,
  branches,
  users,
  products,
  stockLevels,
  stockMovements,
  sales,
  saleItems,
  cashRegisterEntries,
} from "./schema/schema.js";

async function getDefaultContext() {
  const [business] = await db.select().from(businesses).limit(1);
  if (!business) {
    throw new Error("No businesses found. Please sign up in the app first so a business is created.");
  }

  const [adminUser] = await db
    .select()
    .from(users)
    .where(eq(users.businessId, business.id))
    .limit(1);

  if (!adminUser) {
    throw new Error("No users found for this business. Create at least one user first.");
  }

  const [existingMain] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.businessId, business.id), eq(branches.name, "Main")))
    .limit(1);

  let mainBranchId: number;
  if (existingMain) {
    mainBranchId = existingMain.id;
  } else {
    const [created] = await db
      .insert(branches)
      .values({
        businessId: business.id,
        name: "Main",
        location: "Downtown",
      })
      .returning({ id: branches.id });
    if (!created) throw new Error("Failed to create Main branch");
    mainBranchId = created.id;
  }

  const [existingSecondary] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.businessId, business.id), eq(branches.name, "Mall Branch")))
    .limit(1);

  let secondaryBranchId: number;
  if (existingSecondary) {
    secondaryBranchId = existingSecondary.id;
  } else {
    const [created] = await db
      .insert(branches)
      .values({
        businessId: business.id,
        name: "Mall Branch",
        location: "City Mall",
      })
      .returning({ id: branches.id });
    if (!created) throw new Error("Failed to create Mall Branch");
    secondaryBranchId = created.id;
  }

  return { business, adminUser, mainBranchId, secondaryBranchId };
}

async function seedProducts(businessId: number) {
  const productData = [
    {
      name: "Coca-Cola 500ml Bottle",
      sku: "BEV-COC-500",
      category: "Beverages",
      costPrice: 0.4,
      sellPrice: 1.0,
      status: "active" as const,
    },
    {
      name: "Fresh Milk 1L",
      sku: "DAIRY-MILK-1L",
      category: "Dairy",
      costPrice: 0.7,
      sellPrice: 1.4,
      status: "active" as const,
    },
    {
      name: "All-Purpose Flour 2kg",
      sku: "GROC-FLOUR-2KG",
      category: "Groceries",
      costPrice: 1.1,
      sellPrice: 2.2,
      status: "active" as const,
    },
    {
      name: "AA Batteries (4 pack)",
      sku: "ELEC-BATT-AA4",
      category: "Electronics",
      costPrice: 1.5,
      sellPrice: 3.0,
      status: "active" as const,
    },
    {
      name: "Bluetooth Speaker",
      sku: "ELEC-BT-SPKR",
      category: "Electronics",
      costPrice: 12.0,
      sellPrice: 24.99,
      status: "active" as const,
    },
    {
      name: "Office Notebook A5",
      sku: "STAT-NBK-A5",
      category: "Stationery",
      costPrice: 0.8,
      sellPrice: 1.6,
      status: "active" as const,
    },
    {
      name: "Hand Sanitizer 500ml",
      sku: "HEALTH-SAN-500",
      category: "Health & Hygiene",
      costPrice: 1.2,
      sellPrice: 2.5,
      status: "active" as const,
    },
    {
      name: "Unisex T-Shirt - Medium",
      sku: "APP-TSHIRT-M",
      category: "Apparel",
      costPrice: 3.0,
      sellPrice: 7.5,
      status: "inactive" as const,
    },
  ];

  const created: { [sku: string]: number } = {};

  for (const p of productData) {
    const [existing] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.businessId, businessId), eq(products.sku, p.sku)))
      .limit(1);

    if (existing) {
      created[p.sku] = existing.id;
      continue;
    }

    const [inserted] = await db
      .insert(products)
      .values({
        businessId,
        name: p.name,
        sku: p.sku,
        category: p.category,
        costPrice: p.costPrice.toString(),
        sellPrice: p.sellPrice.toString(),
        status: p.status,
      })
      .returning({ id: products.id });

    if (!inserted) {
      throw new Error(`Failed to insert product ${p.sku}`);
    }

    created[p.sku] = inserted.id;
  }

  return created;
}

async function seedStockAndMovements(params: {
  businessId: number;
  adminUserId: number;
  mainBranchId: number;
  secondaryBranchId: number;
  productIdsBySku: Record<string, number>;
}) {
  const { businessId, adminUserId, mainBranchId, secondaryBranchId, productIdsBySku } = params;

  const stockPlan: Array<{
    sku: string;
    mainQty: number;
    secondaryQty: number;
  }> = [
    { sku: "BEV-COC-500", mainQty: 120, secondaryQty: 60 },
    { sku: "DAIRY-MILK-1L", mainQty: 40, secondaryQty: 20 },
    { sku: "GROC-FLOUR-2KG", mainQty: 80, secondaryQty: 40 },
    { sku: "ELEC-BATT-AA4", mainQty: 50, secondaryQty: 25 },
    { sku: "ELEC-BT-SPKR", mainQty: 12, secondaryQty: 6 },
    { sku: "STAT-NBK-A5", mainQty: 150, secondaryQty: 75 },
    { sku: "HEALTH-SAN-500", mainQty: 70, secondaryQty: 35 },
    { sku: "APP-TSHIRT-M", mainQty: 0, secondaryQty: 0 },
  ];

  for (const row of stockPlan) {
    const productId = productIdsBySku[row.sku];
    if (!productId) continue;

    // Main branch stock level & opening balance
    const [existingMain] = await db
      .select({ id: stockLevels.id })
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.businessId, businessId),
          eq(stockLevels.branchId, mainBranchId),
          eq(stockLevels.productId, productId),
        ),
      )
      .limit(1);

    if (!existingMain && row.mainQty > 0) {
      const [level] = await db
        .insert(stockLevels)
        .values({
          businessId,
          branchId: mainBranchId,
          productId,
          quantity: row.mainQty,
        })
        .returning({ id: stockLevels.id });

      await db.insert(stockMovements).values({
        businessId,
        branchId: mainBranchId,
        productId,
        userId: adminUserId,
        type: "opening_balance",
        quantity: row.mainQty,
        note: "Initial stock (seed)",
      });

      // Simulate a purchase top-up for some items
      if (["BEV-COC-500", "ELEC-BT-SPKR", "HEALTH-SAN-500"].includes(row.sku)) {
        await db.insert(stockMovements).values({
          businessId,
          branchId: mainBranchId,
          productId,
          userId: adminUserId,
          type: "purchase",
          quantity: 10,
          note: "Restock purchase (seed)",
        });
      }
    }

    // Secondary branch stock level & opening balance
    const [existingSecondary] = await db
      .select({ id: stockLevels.id })
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.businessId, businessId),
          eq(stockLevels.branchId, secondaryBranchId),
          eq(stockLevels.productId, productId),
        ),
      )
      .limit(1);

    if (!existingSecondary && row.secondaryQty > 0) {
      await db
        .insert(stockLevels)
        .values({
          businessId,
          branchId: secondaryBranchId,
          productId,
          quantity: row.secondaryQty,
        })
        .returning({ id: stockLevels.id });

      await db.insert(stockMovements).values({
        businessId,
        branchId: secondaryBranchId,
        productId,
        userId: adminUserId,
        type: "opening_balance",
        quantity: row.secondaryQty,
        note: "Initial stock (seed)",
      });
    }
  }
}

async function seedSalesAndPayments(params: {
  businessId: number;
  mainBranchId: number;
  adminUserId: number;
  productIdsBySku: Record<string, number>;
}) {
  const { businessId, mainBranchId, adminUserId, productIdsBySku } = params;

  // Simple completed sale with multiple items, cash payment
  const sale1Items = [
    { sku: "BEV-COC-500", quantity: 3, unitPrice: 1.0 },
    { sku: "GROC-FLOUR-2KG", quantity: 1, unitPrice: 2.2 },
  ];

  const sale1Total = sale1Items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  const [sale1] = await db
    .insert(sales)
    .values({
      businessId,
      branchId: mainBranchId,
      userId: adminUserId,
      totalAmount: sale1Total.toFixed(2),
      status: "completed",
    })
    .returning({ id: sales.id });

  if (!sale1) {
    throw new Error("Failed to create sale1");
  }

  for (const item of sale1Items) {
    const productId = productIdsBySku[item.sku];
    if (!productId) continue;

    const lineTotal = item.quantity * item.unitPrice;

    await db.insert(saleItems).values({
      saleId: sale1.id,
      productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
    });
  }

  await db.insert(cashRegisterEntries).values({
    businessId,
    branchId: mainBranchId,
    saleId: sale1.id,
    paymentMethod: "cash",
    referenceCode: "CASH-0001",
    amount: sale1Total.toFixed(2),
    recordedByUserId: adminUserId,
  });

  // M-Pesa card-like sale to showcase different payment methods
  const sale2Items = [
    { sku: "ELEC-BT-SPKR", quantity: 1, unitPrice: 24.99 },
    { sku: "HEALTH-SAN-500", quantity: 2, unitPrice: 2.5 },
  ];
  const sale2Total = sale2Items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  const [sale2] = await db
    .insert(sales)
    .values({
      businessId,
      branchId: mainBranchId,
      userId: adminUserId,
      totalAmount: sale2Total.toFixed(2),
      status: "completed",
    })
    .returning({ id: sales.id });

  if (!sale2) {
    throw new Error("Failed to create sale2");
  }

  for (const item of sale2Items) {
    const productId = productIdsBySku[item.sku];
    if (!productId) continue;

    const lineTotal = item.quantity * item.unitPrice;

    await db.insert(saleItems).values({
      saleId: sale2.id,
      productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
    });
  }

  await db.insert(cashRegisterEntries).values({
    businessId,
    branchId: mainBranchId,
    saleId: sale2.id,
    paymentMethod: "mpesa",
    referenceCode: "MPESA-ABC123",
    amount: sale2Total.toFixed(2),
    recordedByUserId: adminUserId,
  });
}

export async function main() {
  const { business, adminUser, mainBranchId, secondaryBranchId } = await getDefaultContext();

  const productIdsBySku = await seedProducts(business.id);

  await seedStockAndMovements({
    businessId: business.id,
    adminUserId: adminUser.id,
    mainBranchId,
    secondaryBranchId,
    productIdsBySku,
  });

  await seedSalesAndPayments({
    businessId: business.id,
    mainBranchId,
    adminUserId: adminUser.id,
    productIdsBySku,
  });
}

// Run immediately when this script is executed with tsx/node
main()
  .then(() => {
    console.log("Seed data created successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Failed to seed data:", err);
    process.exit(1);
  });

