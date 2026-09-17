import { appBaseUrl } from "@/lib/env";
import { noStoreJson as json } from "@/lib/http";
import { renderQrPng } from "@/lib/operator/qr";
import { operatorRoute } from "@/lib/operator/route";
import { shopUrls } from "@/lib/operator/shop-resource";
import { findShop } from "@/lib/operator/shops";

/**
 * The poster's QR code: the Shop's queue URL as a 1024×1024 PNG. Rendered on
 * request rather than stored, because it is a pure function of the slug and
 * `APP_BASE_URL` — which is also why neither may change once a poster is up.
 */
export const GET = operatorRoute<RouteContext<"/api/operator/shops/[slug]/qr.png">>(
  async (_request, context) => {
    const { slug } = await context.params;
    if (!(await findShop(slug))) return json({ error: "not_found" }, 404);

    const { queueUrl } = shopUrls(appBaseUrl(), slug);

    return new Response(new Uint8Array(renderQrPng(queueUrl)), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="${slug}-qr.png"`,
        "Cache-Control": "no-store",
      },
    });
  },
);
