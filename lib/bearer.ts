import { createHash, timingSafeEqual } from "node:crypto";
import { MissingEnvError, requireEnv } from "@/lib/env";
import { reportUnexpected } from "@/lib/error-reporting";
import { noStoreJson } from "@/lib/http";

const BEARER = /^Bearer[ ]+(\S+)$/i;

/**
 * Compares a request's bearer token with the key a route expects, in constant
 * time.
 *
 * Both sides are hashed first so the comparison always runs over 32 bytes; a
 * direct compare would need a length check that leaks the key's length.
 */
export function isAuthorizedBearer(
  authorization: string | null | undefined,
  expectedKey: string,
): boolean {
  if (!expectedKey) return false;

  const presented = BEARER.exec(authorization ?? "")?.[1];
  if (!presented) return false;

  return timingSafeEqual(sha256(presented), sha256(expectedKey));
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export type Handler<Context> = (request: Request, context: Context) => Promise<Response>;

/**
 * What every route that authenticates with a bearer key does around its own
 * work — the Operator admin API (backend.md §8) and the cron route (§9): check
 * the key held in the environment variable `keyName`, answering 401 without it,
 * and turn anything unexpected into an `internal_error` 500, reported to Sentry
 * under `failure` rather than returned.
 *
 * A missing environment variable is the one thing allowed to crash through,
 * the key included: that is a broken deploy, and a 401 that looks like a typo
 * or a 500 that looks like a bug would hide it.
 */
export function bearerRoute<Context = unknown>(
  keyName: string,
  failure: string,
  handler: Handler<Context>,
): Handler<Context> {
  return async (request, context) => {
    const key = requireEnv(keyName, process.env[keyName]);
    if (!isAuthorizedBearer(request.headers.get("authorization"), key)) {
      return noStoreJson({ error: "unauthorized" }, 401);
    }

    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof MissingEnvError) throw error;
      reportUnexpected(failure, error);
      return noStoreJson({ error: "internal_error" }, 500);
    }
  };
}
