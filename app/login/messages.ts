// Kept out of actions.ts on purpose: a "use server" file may only export async
// functions, and adding one `const` there breaks every action in the file.

/** One message for a wrong email and a wrong password alike, so the form can't be
 * used to find out which Owner accounts exist. */
export const WRONG_CREDENTIALS = "Wrong email or password";

/** Shown to the Owner of a Deactivated Shop: at sign-in, on the way out of the
 * dashboard, and as the toast when a dashboard action is refused for it
 * (`ownerErrorMessage`). Names the Operator, the only one who can switch a Shop
 * back on. */
export const SHOP_INACTIVE =
  "This Shop has been switched off. Contact the Operator to turn it back on.";

/** Shown to the Owner whose own Close Shop ended a week-old Sign-in (ADR 0006).
 * Says the Queue is fine, because it was closing the Shop that sent them here. */
export const WEEKLY_SIGN_IN =
  "The Shop closed as usual. Owners sign in again once a week, and this does not affect the Queue.";
