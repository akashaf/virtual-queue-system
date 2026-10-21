"use server";

import { redirect } from "next/navigation";
import { endOtherSignIns } from "@/lib/auth/owner";
import { createClient } from "@/lib/supabase/server";

export type SignOutOthersResult = "done" | "failed";

/**
 * Shaped for `useActionState`, so the Owner stays on the Settings page and is
 * told how it went. Only this device's own Sign-in is needed: ending one's own
 * other Sign-ins is safe even for a Deactivated Shop's Owner. A device that has
 * itself been signed out goes where its next request would send it anyway.
 */
export async function signOutOtherDevices(
  _previous: SignOutOthersResult | null,
  _formData: FormData,
): Promise<SignOutOthersResult> {
  const result = await endOtherSignIns(await createClient());
  if (result === "signed_out") redirect("/login");
  return result;
}
