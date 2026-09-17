import { bearerRoute, type Handler } from "@/lib/bearer";
import { noStoreJson } from "@/lib/http";
import type { Rejected } from "./shop-input";

/**
 * What every Operator admin route does around its own work: check
 * `OPERATOR_API_KEY`, and turn anything unexpected into the `internal_error`
 * 500 backend.md §8 documents.
 */
export function operatorRoute<Context = unknown>(handler: Handler<Context>): Handler<Context> {
  return bearerRoute("OPERATOR_API_KEY", "Operator request failed", handler);
}

/**
 * The request body, parsed and validated — or the 400 that says which field was
 * wrong, ready to return.
 */
export async function readJsonBody<Value>(
  request: Request,
  parse: (body: unknown) => { ok: true; value: Value } | Rejected,
): Promise<Value | Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return noStoreJson({ error: "invalid_body", field: "body", message: "Expected JSON." }, 400);
  }

  const parsed = parse(payload);
  if (!parsed.ok) {
    return noStoreJson(
      { error: "invalid_body", field: parsed.field, message: parsed.message },
      400,
    );
  }
  return parsed.value;
}
