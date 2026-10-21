import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutOthers } from "./sign-out-others";

export const metadata: Metadata = { title: "Settings" };

/**
 * The Owner's settings (frontend.md §4.4). For now one action, for a lost
 * device or a former staff member who still has access. The layout is the gate.
 */
export default function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-4">
      <section aria-labelledby="devices" className="flex flex-col gap-2">
        <h2 id="devices" className="text-sm font-medium text-muted-foreground">
          Devices
        </h2>
        <Card className="gap-4 py-4">
          <CardHeader className="px-4">
            <CardTitle>Signed in somewhere else?</CardTitle>
            <CardDescription>
              For a lost phone, or someone who should no longer have access. This device stays
              signed in.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <SignOutOthers />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
