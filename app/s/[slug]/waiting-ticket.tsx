import { OutOfDateNotice } from "@/components/out-of-date-notice";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CustomerView, LastCallChoice } from "@/lib/customer/view";
import { format, type Dictionary } from "@/lib/i18n";
import { formatTicketNumber } from "@/lib/ticket";
import { formatMalaysiaTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { LeaveButton } from "./leave-button";
import { PushStatusNote, type PushStatus } from "./push-alerts";

type Ticket = NonNullable<CustomerView["ticket"]>;

/** The Customer's screen while their Ticket is Waiting: their place, the Estimated Wait, Heads-up and Last Call. */
export function Waiting({
  ticket,
  estimate,
  dict,
  headsUp,
  dayStarted,
  lastCall,
  pushStatus,
  onTurnOnPush,
  outOfDate,
  updatedAt,
  onRetry,
  onChoose,
  onLeave,
}: {
  ticket: Ticket;
  /** The Estimated Wait range, or null while the Shop hasn't served enough today. */
  estimate: CustomerView["estimate"];
  dict: Dictionary;
  /** Inside the Heads-up Threshold: time to walk back. */
  headsUp: boolean;
  /** The Queue Day has had its first Call next; before that nobody heads back yet. */
  dayStarted: boolean;
  /** Last Call is on: the shop is closing soon, and this Ticket must choose. */
  lastCall: boolean;
  /** Whether push alerts are on, or the page's sound is all there is. */
  pushStatus: PushStatus;
  onTurnOnPush: () => void;
  /** The last refetch failed, so the place shown may already have moved on. */
  outOfDate: boolean;
  /** When the page last heard from the server. */
  updatedAt: Date;
  onRetry: () => void;
  onChoose: (choice: LastCallChoice) => void;
  onLeave: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4" aria-live="polite">
      {outOfDate ? (
        // Above the Ticket, so it is read before the number it qualifies
        // (frontend.md §3.1). No role of its own: the Waiting view is already
        // a live region.
        <OutOfDateNotice
          tone="strong"
          title={dict.outOfDateTitle}
          detail={format(dict.outOfDateAsOf, { time: formatMalaysiaTime(updatedAt) })}
          retryLabel={dict.retry}
          onRetry={onRetry}
        />
      ) : null}
      <TicketCard ticket={ticket} dict={dict} outOfDate={outOfDate} />
      {estimate ? (
        <p className="text-center text-sm text-muted-foreground">
          {estimateLabel(estimate, dict)}
        </p>
      ) : null}
      {headsUp ? (
        // No role of its own: the Waiting view is already a live region.
        <Alert role={undefined} className="border-primary bg-primary text-primary-foreground">
          <AlertTitle className="line-clamp-none text-center text-lg font-semibold">
            {dict.headBackNow}
          </AlertTitle>
        </Alert>
      ) : null}
      {!dayStarted && !lastCall ? (
        // In place of the banner, and as calm as it: after Close Shop the next
        // day's front Tickets wait all night with nobody being called (#41).
        // Not beside the Last Call question, which says the shop is closing.
        <p className="text-center text-base text-balance">
          {ticket.position === 0 ? dict.notCallingYetFirst : dict.notCallingYet}
        </p>
      ) : null}
      {lastCall ? (
        <LastCallChoiceCard
          choice={ticket.lastCallChoice}
          dict={dict}
          onChoose={onChoose}
        />
      ) : null}
      <p className="text-center text-sm text-muted-foreground">{dict.inPersonNote}</p>
      <PushStatusNote status={pushStatus} dict={dict} onTurnOn={onTurnOnPush} />
      <LeaveButton dict={dict} onLeave={onLeave} className="mt-auto w-full" />
    </div>
  );
}

/**
 * The Ticket number first and largest — read at arm's length, or held up for
 * the Owner — with where it stands in the Queue as a Waiting status badge.
 */
function TicketCard({
  ticket,
  dict,
  outOfDate,
}: {
  ticket: Ticket;
  dict: Dictionary;
  outOfDate: boolean;
}) {
  return (
    <Card>
      {/* Dimmed whole while out of date: a number and a count that may have
          moved on should not read as confidently as current ones. */}
      <CardContent
        className={cn(
          "flex flex-col items-center gap-3 text-center transition-opacity",
          outOfDate && "opacity-60",
        )}
      >
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {dict.yourNumber}
        </p>
        {/* frontend.md §5: at least 64px, readable at arm's length across a shop.
            No larger, or a four-digit #1000 would not fit the card at 360px. */}
        <p className="text-7xl leading-none font-bold tracking-tight tabular-nums">
          {formatTicketNumber(ticket.number)}
        </p>
        {ticket.carriedOver ? (
          <Badge variant="secondary">{dict.carriedOverBadge}</Badge>
        ) : null}
        <Badge variant="waiting" className="px-3 py-1 text-base whitespace-normal">
          {aheadLabel(ticket.position, dict)}
        </Badge>
      </CardContent>
    </Card>
  );
}

/**
 * The Last Call question, on screen for as long as it is open: stay today, or
 * move to the next Queue Day. The current answer is marked, and stays
 * changeable until Close Shop acts on it — which is also why there is no
 * "confirm": the card itself shows what is currently chosen.
 */
function LastCallChoiceCard({
  choice,
  dict,
  onChoose,
}: {
  choice: LastCallChoice | null;
  dict: Dictionary;
  onChoose: (choice: LastCallChoice) => void;
}) {
  return (
    <Card role="group" aria-label={dict.lastCallChoiceTitle} className="gap-4 border-2 border-primary">
      <CardHeader>
        <CardTitle>{dict.lastCallChoiceTitle}</CardTitle>
        <CardDescription>{dict.lastCallChoiceBody}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ChoiceButton
          label={dict.choiceCarry}
          chosen={choice === "carry"}
          onSelect={() => onChoose("carry")}
        />
        <ChoiceButton
          label={dict.choiceStay}
          chosen={choice === "stay"}
          onSelect={() => onChoose("stay")}
        />
        {choice !== null ? (
          <p className="text-sm text-muted-foreground">{dict.choiceChangeNote}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ChoiceButton({
  label,
  chosen,
  onSelect,
}: {
  label: string;
  chosen: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      variant={chosen ? "default" : "outline"}
      aria-pressed={chosen}
      className="h-12 text-base"
      onClick={onSelect}
    >
      {chosen ? `✓ ${label}` : label}
    </Button>
  );
}

function estimateLabel(
  estimate: NonNullable<CustomerView["estimate"]>,
  dict: Dictionary,
): string {
  // Rounding to 5 minutes can land both ends on the same mark, and a range of
  // "15–15 min" reads like a bug rather than an estimate.
  return estimate.minMinutes === estimate.maxMinutes
    ? format(dict.estimatedWaitAbout, { minutes: estimate.minMinutes })
    : format(dict.estimatedWait, {
        min: estimate.minMinutes,
        max: estimate.maxMinutes,
      });
}

function aheadLabel(position: number, dict: Dictionary): string {
  if (position === 0) return dict.youAreNext;
  if (position === 1) return dict.aheadOfYouOne;
  return format(dict.aheadOfYou, { count: position });
}
