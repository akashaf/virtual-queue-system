import { noStoreJson as json } from "@/lib/http";
import { operatorRoute, readJsonBody } from "@/lib/operator/route";
import { parseOwnerPasswordInput } from "@/lib/operator/shop-input";
import { resetOwnerPassword } from "@/lib/operator/shops";

/**
 * Gives an Owner a new password. There is no forgot-password email in the MVP
 * (backend.md §12), so this is how a locked-out Owner gets back in: they ask
 * the Operator, who sets one and passes it on.
 */
export const POST = operatorRoute<RouteContext<"/api/operator/shops/[slug]/owner-password">>(
  async (request, context) => {
    const input = await readJsonBody(request, parseOwnerPasswordInput);
    if (input instanceof Response) return input;

    const { slug } = await context.params;
    const outcome = await resetOwnerPassword(slug, input.password);
    if (outcome === "not_found") return json({ error: "not_found" }, 404);

    // Nothing to say beyond "done", and never the password back.
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  },
);
