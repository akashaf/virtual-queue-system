import type { Database } from "@/lib/supabase/database.types";

type ShopRow = Database["public"]["Tables"]["shops"]["Row"];
type OperatorShopRow = Database["public"]["Functions"]["operator_shops"]["Returns"][number];

/** A Shop as the Operator admin API returns it: camelCase, no owner_user_id. */
export interface ShopResource {
  id: string;
  slug: string;
  name: string;
  ownerEmail: string;
  lat: number;
  lng: number;
  joinRadiusM: number;
  headsUpThreshold: number;
  maxQueueSize: number;
  isActive: boolean;
  joiningState: ShopRow["joining_state"];
  currentQueueDayId: string | null;
  createdAt: string;
  /** Served Tickets in the current Billing Month: what the invoice will count so far. */
  servedThisMonth: number;
}

/**
 * The columns the resource is built from — what `operator_shops` returns and
 * the `shops` row share, so a freshly created Shop and a listed one map the
 * same way.
 */
type ShopColumns = Omit<ShopRow, "owner_user_id">;

export function toShopResource(
  shop: ShopColumns,
  ownerEmail: string,
  servedThisMonth: number,
): ShopResource {
  return {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    ownerEmail,
    lat: shop.lat,
    lng: shop.lng,
    joinRadiusM: shop.join_radius_m,
    headsUpThreshold: shop.heads_up_threshold,
    maxQueueSize: shop.max_queue_size,
    isActive: shop.is_active,
    joiningState: shop.joining_state,
    currentQueueDayId: shop.current_queue_day_id,
    createdAt: shop.created_at,
    servedThisMonth,
  };
}

/** One row of `operator_shops` as the API returns it. */
export function toOperatorShopResource(row: OperatorShopRow): ShopResource {
  return toShopResource(row, row.owner_email, row.served_this_month);
}

/** The QR code target, and the URL that renders that code. Both need APP_BASE_URL. */
export function shopUrls(baseUrl: string, slug: string) {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    queueUrl: `${base}/s/${slug}`,
    qrUrl: `${base}/api/operator/shops/${slug}/qr.png`,
  };
}
