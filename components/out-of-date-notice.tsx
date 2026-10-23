import { WifiOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Said only while a live screen has stopped updating (`lib/out-of-date.ts`),
 * and in the neutral ink of an ending rather than a status colour: nothing
 * about any one Ticket changed. The caller places it inside a live region, so
 * it is announced when it appears.
 */
export function OutOfDateNotice({
  title,
  detail,
  retryLabel,
  onRetry,
}: {
  title: string;
  /** When the screen last heard from the server, and that it is trying again. */
  detail: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted py-2 pr-2 pl-3">
      <WifiOffIcon className="size-5 shrink-0" aria-hidden />
      <p className="flex flex-1 flex-col text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">{detail}</span>
      </p>
      <Button type="button" variant="outline" className="h-11" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
