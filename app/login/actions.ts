"use server";

import { redirect } from "next/navigation";
import { findOwnerShop } from "@/lib/auth/owner";
import { createClient } from "@/lib/supabase/server";
import { SHOP_INACTIVE, WRONG_CREDENTIALS } from "./messages";

export interface SignInState {
  error: string | null;
  /** What the Owner typed, handed back so a refused attempt doesn't clear it. */
  email: string;
}

export async function signIn(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  // Trimmed and capped at the longest valid address, since it is also handed back.
  const email = String(formData.get("email") ?? "").trim().slice(0, 254);
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: WRONG_CREDENTIALS, email };

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: WRONG_CREDENTIALS, email };

  // An Owner without an active Shop must not keep the session, or the dashboard
  // would bounce them straight back here.
  if (!(await findOwnerShop(supabase, data.user.id))) {
    await supabase.auth.signOut();
    return { error: SHOP_INACTIVE, email };
  }

  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
