import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchOwnerHistory } from "@/lib/owner/history";
import { formatRinggit, STATUS_LABELS, type HistoryTicket } from "@/lib/owner/history-view";
import { formatTicketNumber } from "@/lib/ticket";
import { formatMalaysiaDay, formatMalaysiaTime } from "@/lib/time";

export const metadata: Metadata = { title: "History" };

/**
 * Today's Tickets, recent Served counts and what the Owner owes so far this
 * month (frontend.md §4.3). Read once per visit: nothing here needs to move
 * while the Owner looks at it, and there is nothing to export.
 */
export default async function HistoryPage() {
  const history = await fetchOwnerHistory();
  // The layout turns this Owner away too, but both render at once.
  if (!history) redirect("/login?error=inactive");

  const { today, servedByDay, thisMonth } = history;

  return (
    <main className="flex flex-1 flex-col gap-8 px-4 py-4">
      <section aria-labelledby="today" className="flex flex-col gap-2">
        <h2 id="today" className="text-sm font-medium text-muted-foreground">
          Today
        </h2>
        {today.length === 0 ? (
          <p className="text-muted-foreground">No customers yet today.</p>
        ) : (
          <TodayTable tickets={today} />
        )}
      </section>

      <section aria-labelledby="recent-days" className="flex flex-col gap-3">
        {/* The database decides how many days; the heading just counts them. */}
        <h2 id="recent-days" className="text-sm font-medium text-muted-foreground">
          Last {servedByDay.length} days
        </h2>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-sm text-muted-foreground">This month</p>
          <p className="text-lg font-semibold tabular-nums">
            {`Served: ${thisMonth.servedCount} · Amount due: ${formatRinggit(thisMonth.amountSen)}`}
          </p>
        </div>
        <ol className="flex flex-col divide-y rounded-lg border">
          {servedByDay.map(({ day, servedCount }) => (
            <li key={day} className="flex items-center justify-between px-4 py-2">
              <span>{formatMalaysiaDay(day)}</span>
              <span
                className={
                  servedCount === 0
                    ? "text-muted-foreground tabular-nums"
                    : "font-medium tabular-nums"
                }
              >
                {servedCount} served
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

/** Six columns do not fit a 360 px phone, so the table scrolls on its own. */
function TodayTable({ tickets }: { tickets: HistoryTicket[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">No.</th>
            <th scope="col" className="px-3 py-2 font-medium">Name</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium">Joined</th>
            <th scope="col" className="px-3 py-2 font-medium">Called</th>
            <th scope="col" className="px-3 py-2 font-medium">Served</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {tickets.map((ticket) => (
            <tr key={ticket.id}>
              <td className="px-3 py-2 font-semibold tabular-nums">
                {formatTicketNumber(ticket.number)}
              </td>
              <td className="max-w-40 truncate px-3 py-2">{ticket.name ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2">{STATUS_LABELS[ticket.status]}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                {formatMalaysiaTime(ticket.joinedAt)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                {ticket.calledAt ? formatMalaysiaTime(ticket.calledAt) : "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                {ticket.servedAt ? formatMalaysiaTime(ticket.servedAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
