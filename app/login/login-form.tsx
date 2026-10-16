"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";
import { flushSync } from "react-dom";
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
  const [passwordShown, setPasswordShown] = useState(false);
  const message = state.error ?? notice;

  return (
    <form
      action={formAction}
      // Hidden again before the form goes: a refused attempt should not leave
      // the password on screen at the counter, and password managers only offer
      // to save a field that is still a password field when it is submitted.
      onSubmit={() => flushSync(() => setPasswordShown(false))}
      className="flex flex-col gap-6"
    >
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
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={passwordShown ? "text" : "password"}
            autoComplete="current-password"
            required
            className="h-11 pr-11"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={passwordShown ? "Hide password" : "Show password"}
            aria-controls="password"
            onClick={() => setPasswordShown((shown) => !shown)}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
          >
            {passwordShown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
        </div>
      </div>

      {message ? <LoginNotice message={message} /> : null}

      <Button type="submit" size="lg" className="h-11" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
