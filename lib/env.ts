/** Reads a required environment variable, failing loudly when it is missing. */
export function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
