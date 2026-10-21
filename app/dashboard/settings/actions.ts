"use server";

import { redirect } from "next/navigation";
import { endOtherSignIns } from "@/lib/auth/owner";
import type { OwnerOutcome } from "@/lib/owner/view";
import { createClient } from "@/lib/supabase/server";

/**
 * Shaped for `useActionState`, so the Owner stays on the Settings page and is
 * told how it went. Only this device's own Sign-in is needed: ending one's own
 * other Sign-ins is safe even for a Deactivated Shop's Owner. A device that has
 * itself been signed out goes where its next request would send it anyway.
 */
export async function signOutOtherDevices(
  _previous: OwnerOutcome<null> | null,
  _formData: FormData,
): Promise<OwnerOutcome<null>> {
  const result = await endOtherSignIns(await createClient());
  if (result === "signed_out") redirect("/login");
  return result === "done" ? { ok: true, result: null } : { ok: false, reason: "failed" };
}
