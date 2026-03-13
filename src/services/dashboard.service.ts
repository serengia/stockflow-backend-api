import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { sales, saleItems, products, stockLevels } from "../db/schema/schema.js";

/** Date range helpers using UTC. All daily cutoffs use start/end of day in UTC. */
function getTodayRange(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(from);
  to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

function getYesterdayRange(): { from: Date; to: Date } {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 1);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

function getDateRangeForDays(daysAgo: number): { from: Date; to: Date } {
  const to = new Date();
  to.setUTCHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - daysAgo);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to };
}

/** Previous N days before the "last N days" window (for week-over-week comparison). */
function getPreviousPeriodRange(days: number): { from: Date; to: Date } {
  const to = new Date();
  to.setUTCDate(to.getUTCDate() - days);
  to.setUTCHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to }; // from = today-2*days 00:00, to = today-days 23:59
}

function toNum(val: string | number | null | undefined): number {
  if (val == null) return 0;
  return typeof val === "number" ? val : Number(val);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface DashboardMetricsTrendPoint {
  date: string;
  total: number;
  transactions: number;
}

export interface DashboardMetricsComparisons {
  salesVsYesterdayPercent: number | null;
  profitVsYesterdayPercent: number | null;
  transactionsVsYesterdayPercent: number | null;
  salesVsLastWeekPercent: number | null;
}

export interface DashboardMetrics {
  salesToday: number;
  profitToday: number;
  transactionsToday: number;
  trend: DashboardMetricsTrendPoint[];
  comparisons: DashboardMetricsComparisons;
  stockValueAtCost?: number;
}

export async function getDashboardMetrics(params: {
  businessId: number;
  branchId?: number | null;
  days?: number;
}): Promise<DashboardMetrics> {
  const { businessId, branchId } = params;
  const days = Math.min(30, Math.max(1, params.days ?? 7));

  const baseConditions = [eq(sales.businessId, businessId)];
  if (typeof branchId === "number") {
    baseConditions.push(eq(sales.branchId, branchId));
  }
  const baseWhere = and(...baseConditions);

  const { from: todayFrom, to: todayTo } = getTodayRange();
  const { from: yesterdayFrom, to: yesterdayTo } = getYesterdayRange();
  const { from: sinceDate } = getDateRangeForDays(days);
  const { from: prevWeekFrom, to: prevWeekTo } = getPreviousPeriodRange(days);

  // Fetch today's sales with items and product cost for profit
  const todaySalesRows = await db
    .select({
      saleId: sales.id,
      totalAmount: sales.totalAmount,
      soldAt: sales.soldAt,
      itemQuantity: saleItems.quantity,
      itemUnitPrice: saleItems.unitPrice,
      itemLineTotal: saleItems.lineTotal,
      productCostPrice: products.costPrice,
    })
    .from(sales)
    .innerJoin(saleItems, eq(sales.id, saleItems.saleId))
    .innerJoin(products, eq(saleItems.productId, products.id))
    .where(
      and(
        baseWhere,
        gte(sales.soldAt, todayFrom),
        lte(sales.soldAt, todayTo),
        eq(sales.status, "completed"),
      ),
    );

  // Aggregate today: profit from line items (revenue - cost per item)
  let profitToday = 0;
  for (const row of todaySalesRows) {
    const revenue = toNum(row.itemLineTotal) || toNum(row.itemQuantity) * toNum(row.itemUnitPrice);
    const cost = toNum(row.itemQuantity) * toNum(row.productCostPrice);
    profitToday += revenue - cost;
  }

  // Sales total and transaction count from distinct sales
  const todaySalesForTotal = await db
    .select({ id: sales.id, totalAmount: sales.totalAmount })
    .from(sales)
    .where(
      and(
        baseWhere,
        gte(sales.soldAt, todayFrom),
        lte(sales.soldAt, todayTo),
        eq(sales.status, "completed"),
      ),
    );
  const salesToday = todaySalesForTotal.reduce((s, r) => s + toNum(r.totalAmount), 0);
  const transactionsToday = todaySalesForTotal.length;

  // Fetch yesterday's aggregates for comparison
  const yesterdaySalesRows = await db
    .select({ totalAmount: sales.totalAmount })
    .from(sales)
    .where(
      and(
        baseWhere,
        gte(sales.soldAt, yesterdayFrom),
        lte(sales.soldAt, yesterdayTo),
        eq(sales.status, "completed"),
      ),
    );
  const salesYesterday = yesterdaySalesRows.reduce((s, r) => s + toNum(r.totalAmount), 0);
  const transactionsYesterday = yesterdaySalesRows.length;

  const yesterdaySaleItems = await db
    .select({
      itemQuantity: saleItems.quantity,
      itemLineTotal: saleItems.lineTotal,
      itemUnitPrice: saleItems.unitPrice,
      productCostPrice: products.costPrice,
    })
    .from(sales)
    .innerJoin(saleItems, eq(sales.id, saleItems.saleId))
    .innerJoin(products, eq(saleItems.productId, products.id))
    .where(
      and(
        baseWhere,
        gte(sales.soldAt, yesterdayFrom),
        lte(sales.soldAt, yesterdayTo),
        eq(sales.status, "completed"),
      ),
    );
  let profitYesterday = 0;
  for (const row of yesterdaySaleItems) {
    const revenue = toNum(row.itemLineTotal) || toNum(row.itemQuantity) * toNum(row.itemUnitPrice);
    const cost = toNum(row.itemQuantity) * toNum(row.productCostPrice);
    profitYesterday += revenue - cost;
  }

  // Trend: daily totals for last N days
  const trendRows = await db
    .select({
      date: sql<string>`date_trunc('day', ${sales.soldAt})::date`,
      total: sql<string>`coalesce(sum(${sales.totalAmount}), 0)`,
      transactions: sql<string>`count(*)`,
    })
    .from(sales)
    .where(
      and(
        baseWhere,
        gte(sales.soldAt, sinceDate),
        lte(sales.soldAt, todayTo),
        eq(sales.status, "completed"),
      ),
    )
    .groupBy(sql`date_trunc('day', ${sales.soldAt})::date`)
    .orderBy(sql`date_trunc('day', ${sales.soldAt})::date`);

  const trend: DashboardMetricsTrendPoint[] = trendRows.map((r) => ({
    date: typeof r.date === "string" ? r.date.slice(0, 10) : formatDate(new Date(r.date)),
    total: toNum(r.total),
    transactions: Math.round(toNum(r.transactions)),
  }));

  // Last 7 days vs previous 7 days (when days >= 7)
  let salesVsLastWeekPercent: number | null = null;
  if (days >= 7) {
    const lastWeekRows = await db
      .select({ total: sql<string>`coalesce(sum(${sales.totalAmount}), 0)` })
      .from(sales)
      .where(
        and(
          baseWhere,
          gte(sales.soldAt, sinceDate),
          lte(sales.soldAt, todayTo),
          eq(sales.status, "completed"),
        ),
      );
    const prevWeekRows = await db
      .select({ total: sql<string>`coalesce(sum(${sales.totalAmount}), 0)` })
      .from(sales)
      .where(
        and(
          baseWhere,
          gte(sales.soldAt, prevWeekFrom),
          lte(sales.soldAt, prevWeekTo),
          eq(sales.status, "completed"),
        ),
      );
    const salesLastPeriod = toNum(lastWeekRows[0]?.total ?? 0);
    const salesPrevPeriod = toNum(prevWeekRows[0]?.total ?? 0);
    if (salesPrevPeriod > 0) {
      salesVsLastWeekPercent = Math.round(((salesLastPeriod - salesPrevPeriod) / salesPrevPeriod) * 100);
    }
  }

  const comparisons: DashboardMetricsComparisons = {
    salesVsYesterdayPercent:
      salesYesterday > 0
        ? Math.round(((salesToday - salesYesterday) / salesYesterday) * 100)
        : salesToday > 0
          ? 100
          : null,
    profitVsYesterdayPercent:
      profitYesterday !== 0
        ? Math.round(((profitToday - profitYesterday) / Math.abs(profitYesterday)) * 100)
        : profitToday !== 0
          ? 100
          : null,
    transactionsVsYesterdayPercent:
      transactionsYesterday > 0
        ? Math.round(((transactionsToday - transactionsYesterday) / transactionsYesterday) * 100)
        : transactionsToday > 0
          ? 100
          : null,
    salesVsLastWeekPercent,
  };

  // Optional: stock value at cost (for dashboard card)
  const joinOn =
    typeof branchId === "number"
      ? and(
          eq(stockLevels.productId, products.id),
          eq(stockLevels.businessId, businessId),
          eq(stockLevels.branchId, branchId),
        )
      : and(eq(stockLevels.productId, products.id), eq(stockLevels.businessId, businessId));

  const stockRows = await db
    .select({
      costPrice: products.costPrice,
      quantity: stockLevels.quantity,
    })
    .from(products)
    .innerJoin(stockLevels, joinOn)
    .where(eq(products.businessId, businessId));

  let stockValueAtCost = 0;
  for (const row of stockRows) {
    stockValueAtCost += toNum(row.costPrice) * toNum(row.quantity);
  }

  return {
    salesToday: Math.round(salesToday * 100) / 100,
    profitToday: Math.round(profitToday * 100) / 100,
    transactionsToday,
    trend,
    comparisons,
    stockValueAtCost: Math.round(stockValueAtCost * 100) / 100,
  };
}
