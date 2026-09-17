import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Rejected } from "./shop-input";

/** A Billing Month as the admin API names it. `billing_summary` checks the same. */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One Shop's line on a month's invoice run. */
export interface ShopBilling {
  slug: string;
  name: string;
  servedCount: number;
  amountSen: number;
}

export interface BillingSummary {
  month: string;
  shops: ShopBilling[];
  totalSen: number;
}

/** The `month` query parameter, or the field and message a 400 names. */
export function parseBillingMonth(value: string | null): { ok: true; value: string } | Rejected {
  if (value === null || !MONTH_PATTERN.test(value)) {
    return { ok: false, field: "month", message: "Expected a month as YYYY-MM." };
  }
  return { ok: true, value };
}

/**
 * Every Shop's Served Tickets and amount due for one Billing Month, counted in
 * Malaysia time by `billing_summary`, which also owns the price — so this file
 * only adds the lines up.
 */
export async function billingSummary(month: string): Promise<BillingSummary> {
  const { data, error } = await createAdminClient().rpc("billing_summary", { p_month: month });
  if (error) throw new Error(`billing_summary failed: ${error.message}`);

  const shops = data.map((row) => ({
    slug: row.slug,
    name: row.name,
    servedCount: row.served_count,
    amountSen: row.amount_sen,
  }));

  return {
    month,
    shops,
    totalSen: shops.reduce((total, shop) => total + shop.amountSen, 0),
  };
}
