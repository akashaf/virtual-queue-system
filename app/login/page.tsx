import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOwnerSession } from "@/lib/auth/owner";
import { LoginForm } from "./login-form";
import { SHOP_INACTIVE } from "./messages";

export const metadata: Metadata = { title: "Sign in" };

/**
 * The Owner's way in. There is no sign-up and no forgot-password: Owners are
 * created by the Operator, who also resets passwords (backend.md §8).
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await getOwnerSession();
  if (session.status === "active") redirect("/dashboard");

  // Set by the dashboard when it turns away a Shop deactivated mid-session.
  const { error } = await searchParams;
  const notice = error === "inactive" ? SHOP_INACTIVE : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Shop sign in</h1>
        <p className="text-sm text-muted-foreground">
          Use the email and password the Operator gave you.
        </p>
      </div>

      {notice ? (
        <p role="alert" className="text-sm text-destructive">
          {notice}
        </p>
      ) : null}

      <LoginForm />
    </main>
  );
}
