import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchOwnerQueue } from "@/lib/owner/queue";
import { formatMalaysiaTime } from "@/lib/time";
import { formatTicketNumber } from "@/lib/ticket";

export const metadata: Metadata = { title: "Queue" };

/**
 * The Owner's live Queue. Call next, Done and the rest of the controls arrive
 * with #6; this shows who is here and in what order.
 */
export default async function DashboardPage() {
  const queue = await fetchOwnerQueue();
  // The layout turns this Owner away too, but both render at once, so the page
  // has to survive a Shop that was switched off mid-session on its own.
  if (!queue) redirect("/login?error=inactive");
  const { waiting, called } = queue;

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-4">
      <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
        Waiting {waiting.length} · In chair {called.length}
      </p>

      {waiting.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <p className="text-muted-foreground">Nobody is waiting yet.</p>
          <p className="text-sm text-muted-foreground">
            Customers appear here when they scan your QR code.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {waiting.map((ticket) => (
            <li
              key={ticket.id}
              className="flex items-center gap-4 rounded-lg border px-4 py-3"
            >
              <span className="text-lg font-semibold tabular-nums">
                {formatTicketNumber(ticket.number)}
              </span>
              <span className="flex-1 truncate font-medium">{ticket.name}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatMalaysiaTime(ticket.joinedAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
