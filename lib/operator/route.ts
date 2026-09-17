import { MissingEnvError } from "@/lib/env";
import { reportUnexpected } from "@/lib/error-reporting";
import { noStoreJson } from "@/lib/http";
import { rejectUnauthorizedOperator } from "./auth";
import type { Rejected } from "./shop-input";

type Handler<Context> = (request: Request, context: Context) => Promise<Response>;

/**
 * What every Operator admin route does around its own work: check the bearer
 * key, and turn anything unexpected into the `internal_error` 500 backend.md §8
 * documents, reported rather than returned.
 *
 * A missing environment variable is the one thing allowed to crash through:
 * that is a broken deploy, and a 500 that looks like a bug would hide it.
 */
export function operatorRoute<Context = unknown>(handler: Handler<Context>): Handler<Context> {
  return async (request, context) => {
    const denied = rejectUnauthorizedOperator(request);
    if (denied) return denied;

    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof MissingEnvError) throw error;
      reportUnexpected("Operator request failed", error);
      return noStoreJson({ error: "internal_error" }, 500);
    }
  };
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
