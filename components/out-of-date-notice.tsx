import { WifiOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Said only while a live screen has stopped updating (`lib/out-of-date.ts`),
 * and in neutral ink rather than a status colour: nothing about any one Ticket
 * changed (DESIGN.md, the Status Is Sacred Rule). The caller places it inside a
 * live region, so it is announced when it appears.
 *
 * `quiet` suits the Owner, who is looking at the board anyway. `strong` is the
 * ink inverted, for the Customer page: the open page is the alert of last
 * resort, and a grey box under a confident ticket number went unnoticed on a
 * real phone.
 */
export function OutOfDateNotice({
  title,
  detail,
  retryLabel,
  onRetry,
  tone = "quiet",
}: {
  title: string;
  /** When the screen last heard from the server, and that it is trying again. */
  detail: string;
  retryLabel: string;
  onRetry: () => void;
  tone?: "quiet" | "strong";
}) {
  const strong = tone === "strong";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg",
        strong
          ? "bg-foreground py-3 pr-3 pl-4 text-background"
          : "border bg-muted py-2 pr-2 pl-3",
      )}
    >
      <WifiOffIcon className={cn("shrink-0", strong ? "size-6" : "size-5")} aria-hidden />
      <p className={cn("flex flex-1 flex-col", strong ? "text-base" : "text-sm")}>
        <span className={strong ? "font-semibold" : "font-medium"}>{title}</span>
        <span className={cn(strong ? "text-sm text-background/80" : "text-muted-foreground")}>
          {detail}
        </span>
      </p>
      <Button
        type="button"
        variant={strong ? "secondary" : "outline"}
        className="h-11"
        onClick={onRetry}
      >
        {retryLabel}
      </Button>
    </div>
  );
}
