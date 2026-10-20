import Link from "next/link";
import { redirect } from "next/navigation";
import { HistoryIcon, ListOrderedIcon, LogOutIcon, MenuIcon } from "lucide-react";
import { getOwnerSession } from "@/lib/auth/owner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { signOut } from "@/app/login/actions";

/** Clears the Call next bar: a 3.5rem button, 0.75rem above and below, and a hairline. */
const TOAST_OFFSET = { bottom: "5.5rem" };

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
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 py-3">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {session.shop.name}
          </h1>
          {/* One large button rather than a row of small ones: the shop name keeps
              the width on a phone, and every item stays easy to tap. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="size-11 shrink-0" aria-label="Menu">
                <MenuIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem asChild className="min-h-11">
                <Link href="/dashboard">
                  <ListOrderedIcon />
                  Queue
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="min-h-11">
                <Link href="/dashboard/history">
                  <HistoryIcon />
                  History
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* The menu renders in a portal, outside the form; the button still
                  submits it through the form attribute. */}
              <DropdownMenuItem asChild className="min-h-11">
                <button type="submit" form="sign-out" className="w-full">
                  <LogOutIcon />
                  Sign out
                </button>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <form id="sign-out" action={signOut} hidden />
        </div>
      </header>

      {children}
      {/* Errors and the Undo window, from anywhere in the dashboard. Just above
          the sticky Call next bar, in the gap the queue board leaves free above it:
          at the top, the two-minute Undo toast covered the header's menu on a phone.
          In rem, like the bar, so the two grow together with the text size. */}
      <Toaster position="bottom-center" offset={TOAST_OFFSET} mobileOffset={TOAST_OFFSET} />
    </div>
  );
}
