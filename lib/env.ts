/**
 * A required environment variable is missing. Its own class so a route can let
 * it crash through — a misconfigured deploy must fail loudly, not answer 500s
 * that look like bugs.
 */
export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Missing environment variable ${name}`);
    this.name = "MissingEnvError";
  }
}

/** Reads a required environment variable, failing loudly when it is missing. */
export function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new MissingEnvError(name);
  return value;
}

/** The public origin printed in every QR code, without a trailing slash. */
export function appBaseUrl(): string {
  return requireEnv("APP_BASE_URL", process.env.APP_BASE_URL);
}
