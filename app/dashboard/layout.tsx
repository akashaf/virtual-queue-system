import { redirect } from "next/navigation";
import { getOwnerSession } from "@/lib/auth/owner";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";

/**
 * The authoritative gate for the whole dashboard. It runs on every render,
 * because a Shop can be deactivated in the middle of a session and `proxy.ts`
 * cannot see that.
 */
export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const session = await getOwnerSession();
  // A Deactivated Shop's Owner is told why; a signed-out visitor needs no excuse.
  if (session.status === "inactive") redirect("/login?error=inactive");
  if (session.status !== "active") redirect("/login");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3">
        <h1 className="truncate text-lg font-semibold tracking-tight">
          {session.shop.name}
        </h1>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </header>

      {children}
    </div>
  );
}
