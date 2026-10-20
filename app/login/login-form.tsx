"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type SignInState } from "./actions";
import { LoginNotice } from "./login-notice";
import { SHOP_INACTIVE } from "./messages";

const initialState: SignInState = { error: null, email: "" };
const NOTICE_ID = "login-notice";

/**
 * `notice` is why the dashboard sent the Owner here. It sits where a refused
 * sign-in shows, and the next attempt's own answer replaces it.
 */
export function LoginForm({ notice }: { notice: string | null }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const [passwordShown, setPasswordShown] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const message = state.error ?? notice;
  // A Deactivated Shop is the one refusal that isn't the Owner's mistake; any
  // other, including one added later, is treated as an error.
  const refused = state.error !== null && state.error !== SHOP_INACTIVE;

  // React clears the form after every attempt. The email comes back as its
  // default value; the cursor goes to the password, the field most often mistyped.
  useEffect(() => {
    if (refused) passwordRef.current?.focus();
  }, [state, refused]);

  const invalid = refused
    ? { "aria-invalid": true, "aria-describedby": NOTICE_ID }
    : {};

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
          defaultValue={state.email}
          required
          // 1rem at every width: below that, iPadOS zooms in on focus.
          className="h-12 md:text-base"
          {...invalid}
        />
      </div>

      <div className="flex flex-col gap-3">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            ref={passwordRef}
            id="password"
            name="password"
            type={passwordShown ? "text" : "password"}
            autoComplete="current-password"
            required
            className="h-12 pr-12 md:text-base"
            {...invalid}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={passwordShown ? "Hide password" : "Show password"}
            aria-controls="password"
            onClick={() => setPasswordShown((shown) => !shown)}
            // Inset inside the 3rem field, so its hover fill and focus ring stay off the field's border.
            className="absolute top-1/2 right-0.5 size-11 -translate-y-1/2 text-muted-foreground"
          >
            {passwordShown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
        </div>
      </div>

      {message ? (
        <LoginNotice id={NOTICE_ID} message={message} error={message !== SHOP_INACTIVE} />
      ) : null}

      <Button type="submit" size="lg" className="h-12 text-base" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
