"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type SignInState } from "./actions";
import { LoginNotice } from "./login-notice";

const initialState: SignInState = { error: null };

/**
 * `notice` is why the dashboard sent the Owner here. It sits where a refused
 * sign-in shows, and the next attempt's own answer replaces it.
 */
export function LoginForm({ notice }: { notice: string | null }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const message = state.error ?? notice;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-3">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11"
        />
      </div>

      {message ? <LoginNotice message={message} /> : null}

      <Button type="submit" size="lg" className="h-11" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
