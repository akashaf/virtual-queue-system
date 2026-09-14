const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Whether a value is a UUID, checked before it reaches a `uuid` parameter in
 * Postgres: anything else turns a forged id into a database error rather than a
 * plain refusal.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
