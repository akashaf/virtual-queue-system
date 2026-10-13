import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchOwnerHistory } from "@/lib/owner/history";
import {
  formatRinggit,
  STATUS_BADGES,
  STATUS_LABELS,
  type HistoryTicket,
} from "@/lib/owner/history-view";
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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-4">
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
        <Card className="gap-1 py-4">
          <CardHeader className="px-4">
            <CardDescription>This month</CardDescription>
            <CardTitle className="text-lg leading-snug tabular-nums">
              {`Served: ${thisMonth.servedCount} · Amount due: ${formatRinggit(thisMonth.amountSen)}`}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="py-0">
          <ol className="flex flex-col divide-y">
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
        </Card>
      </section>
    </main>
  );
}

/**
 * Six columns do not fit a 360 px phone, so the table scrolls sideways inside
 * its card and the page itself never does.
 */
function TodayTable({ tickets }: { tickets: HistoryTicket[] }) {
  return (
    <Card className="overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="px-3">No.</TableHead>
            <TableHead scope="col" className="px-3">Name</TableHead>
            <TableHead scope="col" className="px-3">Status</TableHead>
            <TableHead scope="col" className="px-3">Joined</TableHead>
            <TableHead scope="col" className="px-3">Called</TableHead>
            <TableHead scope="col" className="px-3">Served</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((ticket) => (
            <TableRow key={ticket.id}>
              <TableCell className="px-3 font-semibold tabular-nums">
                {formatTicketNumber(ticket.number)}
              </TableCell>
              <TableCell className="max-w-40 truncate px-3">{ticket.name ?? "—"}</TableCell>
              <TableCell className="px-3">
                <Badge variant={STATUS_BADGES[ticket.status]}>
                  {STATUS_LABELS[ticket.status]}
                </Badge>
              </TableCell>
              <TableCell className="px-3 tabular-nums">
                {formatMalaysiaTime(ticket.joinedAt)}
              </TableCell>
              <TableCell className="px-3 tabular-nums">
                {ticket.calledAt ? formatMalaysiaTime(ticket.calledAt) : "—"}
              </TableCell>
              <TableCell className="px-3 tabular-nums">
                {ticket.servedAt ? formatMalaysiaTime(ticket.servedAt) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
