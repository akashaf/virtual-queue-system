import { createHash, timingSafeEqual } from "node:crypto";

const BEARER = /^Bearer[ ]+(\S+)$/i;

/**
 * Compares the request's bearer token with `OPERATOR_API_KEY` in constant time.
 *
 * Both sides are hashed first so the comparison always runs over 32 bytes; a
 * direct compare would need a length check that leaks the key's length.
 */
export function isAuthorizedOperator(
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
