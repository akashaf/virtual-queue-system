/**
 * A required environment variable is missing, or set to something unusable. Its
 * own class so a route can let it crash through — a misconfigured deploy must
 * fail loudly, not answer 500s that look like bugs.
 */
export class MissingEnvError extends Error {
  constructor(name: string, problem = "Missing") {
    super(`${problem} environment variable ${name}`);
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

/**
 * How old an Owner's Sign-in must be for Close Shop to end it (ADR 0006).
 *
 * Not Supabase's `[auth.sessions] timebox`, even after a Pro upgrade: a timebox
 * ends a Sign-in at a fixed time, in the middle of a working day.
 */
export function ownerSignInMaxDays(): number {
  const value = requireEnv("OWNER_SIGN_IN_MAX_DAYS", process.env.OWNER_SIGN_IN_MAX_DAYS);
  if (!/^[1-9]\d*$/.test(value)) {
    // Not a positive whole number.
    throw new MissingEnvError("OWNER_SIGN_IN_MAX_DAYS", "Invalid");
  }
  return Number(value);
}
