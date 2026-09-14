import type { Metadata } from "next";

export const metadata: Metadata = { title: "Queue" };

/** The live Queue arrives with #6; #4 only proves an Owner can get here. */
export default function DashboardPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-muted-foreground">Nobody is waiting yet.</p>
      <p className="text-sm text-muted-foreground">
        Customers appear here when they scan your QR code.
      </p>
    </main>
  );
}
