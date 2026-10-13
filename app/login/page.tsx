import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getOwnerSession } from "@/lib/auth/owner";
import { LoginForm } from "./login-form";
import { SHOP_INACTIVE } from "./messages";

export const metadata: Metadata = { title: "Sign in" };

/**
 * The Owner's way in. There is no sign-up and no forgot-password: Owners are
 * created by the Operator, who also resets passwords (backend.md §8). The
 * layout starts from shadcn's login-01 block.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await getOwnerSession();
  if (session.status === "active") redirect("/dashboard");

  // Set by the dashboard when it turns away a Shop deactivated mid-session.
  const { error } = await searchParams;
  const notice = error === "inactive" ? SHOP_INACTIVE : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl tracking-tight">Shop sign in</h1>
          </CardTitle>
          <CardDescription>Use the email and password the Operator gave you.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm notice={notice} />
        </CardContent>
      </Card>
    </main>
  );
}
