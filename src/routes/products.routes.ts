import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthUser } from "../services/auth.service.js";
import * as productsService from "../services/products.service.js";
import { recordAuditLog } from "../services/audit.service.js";

interface RequestWithBody {
  body?: unknown;
  query?: Record<string, unknown>;
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().optional(),
  belowReorder: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return v.toLowerCase() === "true";
      return false;
    }),
  branchId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return undefined;
    })
    .optional(),
});

const VALID_UNITS = ["piece", "kg", "gram", "liter", "meter", "dozen", "box", "pack"] as const;

const productBodySchema = z.object({
  name: z.string().min(1, "Name is required"),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  category: z.string().optional(),
  unit: z.enum(VALID_UNITS).default("piece"),
  costPrice: z.coerce.number().positive("Cost price must be greater than 0"),
  sellPrice: z.coerce.number().positive("Sell price must be greater than 0"),
  quantity: z.coerce.number().min(0, "Quantity is required"),
  reorderLevel: z.coerce.number().int().min(0).optional(),
  imageUrl: z.string().url().optional(),
});

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return (issue && "message" in issue ? String(issue.message) : undefined) ?? "Validation failed";
}

export const productsRouter = new Router({
  prefix: "/products",
});

// GET /api/v1/products
productsRouter.get("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const query = (ctx.request as RequestWithBody).query ?? {};
  const parsed = listQuerySchema.safeParse(query);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const { belowReorder, branchId: branchIdFromQuery } = parsed.data;

  const branchId =
    typeof branchIdFromQuery === "number"
      ? branchIdFromQuery
      : user.branchId != null
      ? user.branchId
      : undefined;

  const { search, page, limit } = parsed.data;

  const listParams: Parameters<typeof productsService.listProducts>[0] = {
    businessId: user.businessId,
    branchId: branchId ?? null,
    page: page ?? 1,
    limit: limit ?? 200,
    ...(search !== undefined && search !== ""
      ? { search }
      : {}),
  };

  const result = await productsService.listProducts(listParams);

  const data = belowReorder ? result.data.filter((p) => p.quantity < p.reorderLevel) : result.data;

  ctx.status = 200;
  ctx.body = { data, total: result.total, page: result.page, limit: result.limit };
});

// POST /api/v1/products
productsRouter.post("/", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const query = (ctx.request as RequestWithBody).query ?? {};
  const parsedQuery = listQuerySchema
    .pick({ branchId: true })
    .safeParse(query);

  const body = (ctx.request as RequestWithBody).body;
  const parsed = productBodySchema.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const payload = parsed.data;

  const branchIdFromQuery =
    parsedQuery.success && typeof parsedQuery.data.branchId === "number"
      ? parsedQuery.data.branchId
      : undefined;
  const branchId =
    typeof branchIdFromQuery === "number"
      ? branchIdFromQuery
      : user.branchId ?? null;

  const created = await productsService.createProduct({
    businessId: user.businessId,
    branchId,
    userId: user.id,
    name: payload.name,
    sku: payload.sku ?? null,
    barcode: payload.barcode ?? null,
    category: payload.category ?? null,
    unit: payload.unit,
    costPrice: payload.costPrice,
    sellPrice: payload.sellPrice,
    quantity: payload.quantity,
    ...(payload.reorderLevel !== undefined && { reorderLevel: payload.reorderLevel }),
  });

  await recordAuditLog({
    businessId: user.businessId,
    userId: user.id,
    entityType: "product",
    entityId: created.id,
    action: "create",
    changes: {
      productId: created.id,
      name: { to: created.name },
      sku: { to: created.sku },
      category: { to: created.category },
      unit: { to: created.unit },
      costPrice: { to: created.costPrice },
      sellPrice: { to: created.sellPrice },
      quantity: { to: created.quantity },
      reorderLevel: { to: created.reorderLevel },
    },
  });

  ctx.status = 201;
  ctx.body = { data: created };
});

const bulkProductRowSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  category: z.string().optional(),
  unit: z.enum(VALID_UNITS).default("piece"),
  costPrice: z.coerce.number().positive("Cost price must be greater than 0"),
  sellPrice: z.coerce.number().positive("Sell price must be greater than 0"),
  quantity: z.coerce.number().min(0, "Quantity is required"),
  reorderLevel: z.coerce.number().int().min(0).optional(),
});

const bulkCreateSchema = z.object({
  products: z.array(bulkProductRowSchema).min(1).max(500),
});

const organizeSummaryQuerySchema = z.object({
  branchId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return undefined;
    })
    .optional(),
});

const bulkCategoriesSchema = z.object({
  productIds: z.array(z.coerce.number().int().min(1)).min(1),
  category: z.string().min(1),
});

const bulkSkusSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.coerce.number().int().min(1),
        sku: z.string().min(1),
      }),
    )
    .min(1),
});

// POST /api/v1/products/bulk
productsRouter.post("/bulk", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const body = (ctx.request as RequestWithBody).body;
  const parsed = bulkCreateSchema.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const rows: productsService.BulkProductRow[] = parsed.data.products.map((row) => ({
    name: row.name,
    costPrice: row.costPrice,
    sellPrice: row.sellPrice,
    quantity: row.quantity,
    unit: row.unit,
    ...(row.sku !== undefined && { sku: row.sku ?? null }),
    ...(row.category !== undefined && { category: row.category ?? null }),
    ...(row.reorderLevel !== undefined && { reorderLevel: row.reorderLevel }),
  }));

  const result = await productsService.bulkCreateProducts({
    businessId: user.businessId,
    branchId: user.branchId ?? null,
    userId: user.id,
    products: rows,
  });

  await recordAuditLog({
    businessId: user.businessId,
    userId: user.id,
    entityType: "product",
    entityId: "bulk",
    action: "create",
    description: `Bulk import: ${result.created} created, ${result.errors.length} errors`,
  });

  ctx.status = 200;
  ctx.body = { data: result };
});

// GET /api/v1/products/organize/summary
productsRouter.get("/organize/summary", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  if (user.role === "attendant") {
    ctx.status = 403;
    ctx.body = { message: "Only managers or admins can organize inventory", error: { message: "Only managers or admins can organize inventory" } };
    return;
  }
  const query = (ctx.request as RequestWithBody).query ?? {};
  const parsed = organizeSummaryQuerySchema.safeParse(query);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const summary = await productsService.getOrganizeSummary({
    businessId: user.businessId,
  });

  ctx.status = 200;
  ctx.body = { data: summary };
});

// GET /api/v1/products/organize/uncategorized
productsRouter.get(
  "/organize/uncategorized",
  requireAuth,
  async (ctx: Context) => {
    const user = ctx.state.user as AuthUser;
    if (user.role === "attendant") {
      ctx.status = 403;
      ctx.body = { message: "Only managers or admins can organize inventory", error: { message: "Only managers or admins can organize inventory" } };
      return;
    }

    const items = await productsService.listUncategorizedProducts({
      businessId: user.businessId,
      branchId: user.branchId ?? null,
    });

    ctx.status = 200;
    ctx.body = { data: items };
  },
);

// GET /api/v1/products/organize/missing-skus
productsRouter.get(
  "/organize/missing-skus",
  requireAuth,
  async (ctx: Context) => {
    const user = ctx.state.user as AuthUser;
    if (user.role === "attendant") {
      ctx.status = 403;
      ctx.body = { message: "Only managers or admins can organize inventory", error: { message: "Only managers or admins can organize inventory" } };
      return;
    }

    const items = await productsService.listMissingSkuProducts({
      businessId: user.businessId,
      branchId: user.branchId ?? null,
    });

    ctx.status = 200;
    ctx.body = { data: items };
  },
);

// PATCH /api/v1/products/organize/categories
productsRouter.patch(
  "/organize/categories",
  requireAuth,
  async (ctx: Context) => {
    const user = ctx.state.user as AuthUser;
    if (user.role === "attendant") {
      ctx.status = 403;
      ctx.body = { message: "Only managers or admins can organize inventory", error: { message: "Only managers or admins can organize inventory" } };
      return;
    }
    const body = (ctx.request as RequestWithBody).body;
    const parsed = bulkCategoriesSchema.safeParse(body);

    if (!parsed.success) {
      ctx.status = 400;
      const msg = firstIssueMessage(parsed.error);
      ctx.body = { message: msg, error: { message: msg } };
      return;
    }

    const payload = parsed.data;

    const result = await productsService.bulkUpdateCategories({
      businessId: user.businessId,
      branchId: user.branchId ?? null,
      userId: user.id,
      productIds: payload.productIds,
      category: payload.category,
    });

    ctx.status = 200;
    ctx.body = { data: result };
  },
);

// PATCH /api/v1/products/organize/skus
productsRouter.patch(
  "/organize/skus",
  requireAuth,
  async (ctx: Context) => {
    const user = ctx.state.user as AuthUser;
    if (user.role === "attendant") {
      ctx.status = 403;
      ctx.body = { message: "Only managers or admins can organize inventory", error: { message: "Only managers or admins can organize inventory" } };
      return;
    }
    const body = (ctx.request as RequestWithBody).body;
    const parsed = bulkSkusSchema.safeParse(body);

    if (!parsed.success) {
      ctx.status = 400;
      const msg = firstIssueMessage(parsed.error);
      ctx.body = { message: msg, error: { message: msg } };
      return;
    }

    const result = await productsService.bulkUpdateSkus({
      businessId: user.businessId,
      branchId: user.branchId ?? null,
      userId: user.id,
      items: parsed.data.items,
    });

    ctx.status = 200;
    ctx.body = { data: result };
  },
);

// GET /api/v1/products/frequently-sold
const frequentlySoldQuerySchema = z.object({
  branchId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") return Number(v);
      return undefined;
    })
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

productsRouter.get("/frequently-sold", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const query = (ctx.request as RequestWithBody).query ?? {};
  const parsed = frequentlySoldQuerySchema.safeParse(query);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const branchId =
    typeof parsed.data.branchId === "number"
      ? parsed.data.branchId
      : user.branchId != null
      ? user.branchId
      : undefined;

  const data = await productsService.getFrequentlySold({
    businessId: user.businessId,
    branchId: branchId ?? null,
    ...(parsed.data.limit !== undefined && { limit: parsed.data.limit }),
    ...(parsed.data.days !== undefined && { days: parsed.data.days }),
  });

  ctx.status = 200;
  ctx.body = { data };
});

// POST /api/v1/products/:id/adjust
const stockAdjustSchema = z.object({
  type: z.enum(["purchase", "adjustment", "opening_balance"]),
  quantityChange: z.coerce.number(),
  note: z.string().optional(),
});

productsRouter.post("/:id/adjust", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid product id", error: { message: "Invalid product id" } };
    return;
  }

  const body = (ctx.request as RequestWithBody).body;
  const parsed = stockAdjustSchema.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const branchId = user.branchId;
  if (branchId == null) {
    ctx.status = 400;
    ctx.body = { message: "Branch required for stock adjustment", error: { message: "Branch required for stock adjustment" } };
    return;
  }

  const result = await productsService.adjustStock({
    productId: id,
    businessId: user.businessId,
    branchId,
    userId: user.id,
    type: parsed.data.type,
    quantityChange: parsed.data.quantityChange,
    note: parsed.data.note ?? null,
  });

  await recordAuditLog({
    businessId: user.businessId,
    userId: user.id,
    entityType: "product",
    entityId: id,
    action: "stock_change",
    changes: {
      productId: id,
      type: parsed.data.type,
      quantityChange: parsed.data.quantityChange,
      newQuantity: result.quantity,
      note: parsed.data.note ?? null,
    },
  });

  ctx.status = 200;
  ctx.body = { data: result };
});

// GET /api/v1/products/:id/movements
productsRouter.get("/:id/movements", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid product id", error: { message: "Invalid product id" } };
    return;
  }

  const movements = await productsService.getStockMovements({
    productId: id,
    businessId: user.businessId,
    branchId: user.branchId ?? null,
  });

  ctx.status = 200;
  ctx.body = { data: movements };
});

// PATCH /api/v1/products/:id
productsRouter.patch("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid product id", error: { message: "Invalid product id" } };
    return;
  }

  const query = (ctx.request as RequestWithBody).query ?? {};
  const parsedQuery = listQuerySchema
    .pick({ branchId: true })
    .safeParse(query);

  const body = (ctx.request as RequestWithBody).body;
  const parsed = productBodySchema.partial().safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const payload = parsed.data;

  const branchIdFromQuery =
    parsedQuery.success && typeof parsedQuery.data.branchId === "number"
      ? parsedQuery.data.branchId
      : undefined;
  const branchId =
    typeof branchIdFromQuery === "number"
      ? branchIdFromQuery
      : user.branchId ?? null;

  const updated = await productsService.updateProduct({
    id,
    businessId: user.businessId,
    branchId,
    userId: user.id,
    ...(payload.name !== undefined && { name: payload.name }),
    ...(payload.sku !== undefined && { sku: payload.sku ?? null }),
    ...(payload.barcode !== undefined && { barcode: payload.barcode ?? null }),
    ...(payload.category !== undefined && { category: payload.category ?? null }),
    ...(payload.unit !== undefined && { unit: payload.unit }),
    ...(payload.costPrice !== undefined && { costPrice: payload.costPrice }),
    ...(payload.sellPrice !== undefined && { sellPrice: payload.sellPrice }),
    ...(payload.quantity !== undefined && { quantity: payload.quantity }),
    ...(payload.reorderLevel !== undefined && { reorderLevel: payload.reorderLevel }),
  });

  await recordAuditLog({
    businessId: user.businessId,
    userId: user.id,
    entityType: "product",
    entityId: updated.id,
    action: "update",
    changes: {
      productId: updated.id,
      ...(payload.name !== undefined && {
        name: { to: updated.name },
      }),
      ...(payload.sku !== undefined && {
        sku: { to: updated.sku },
      }),
      ...(payload.category !== undefined && {
        category: { to: updated.category },
      }),
      ...(payload.costPrice !== undefined && {
        costPrice: { to: updated.costPrice },
      }),
      ...(payload.sellPrice !== undefined && {
        sellPrice: { to: updated.sellPrice },
      }),
      ...(payload.quantity !== undefined && {
        quantity: { to: updated.quantity },
      }),
      ...(payload.reorderLevel !== undefined && {
        reorderLevel: { to: updated.reorderLevel },
      }),
    },
  });

  ctx.status = 200;
  ctx.body = { data: updated };
});

// DELETE /api/v1/products/:id
productsRouter.delete("/:id", requireAuth, async (ctx: Context) => {
  const user = ctx.state.user as AuthUser;
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid product id", error: { message: "Invalid product id" } };
    return;
  }

  await productsService.deleteProduct({
    id,
    businessId: user.businessId,
  });

  await recordAuditLog({
    businessId: user.businessId,
    userId: user.id,
    entityType: "product",
    entityId: id,
    action: "delete",
    changes: {
      productId: id,
      deleted: true,
    },
  });

  ctx.status = 204;
  ctx.body = null;
});

