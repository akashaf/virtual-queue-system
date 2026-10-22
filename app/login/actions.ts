"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { findOwnerShop } from "@/lib/auth/owner";
import { createClient, createSignInClient } from "@/lib/supabase/server";
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

  // Netlify sets this header and nobody can forge it. Not x-forwarded-for:
  // anyone can prepend to that one and get a fresh rate limit every attempt
  // (third-party.md §3).
  const ownerIp = (await headers()).get("x-nf-client-connection-ip");
  const signInClient = await createSignInClient(ownerIp);

  const { data, error } = await signInClient.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: WRONG_CREDENTIALS, email };

  // As the Owner, from the session cookies sign-in has just set, which a Server
  // Action reads back.
  const supabase = await createClient();

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
