import { CircleAlert, Clock } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * For a social app's own webview (frontend.md §3.1), which gets no Web Push
 * and may drop the page as soon as the Customer switches away.
 */
export function InAppBrowserWarning({ message }: { message: string }) {
  return (
    <Alert>
      <AlertTitle className="line-clamp-none">{message}</AlertTitle>
    </Alert>
  );
}

/** A wait with nothing to do but read what is happening. */
export function Busy({ message }: { message: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="my-auto text-center text-lg text-muted-foreground"
    >
      {message}
    </p>
  );
}

/** A join that could not go ahead, and the way to try again. */
export function Blocked({
  title,
  detail,
  action,
  onRetry,
}: {
  title: string;
  detail?: string;
  action: string;
  onRetry: () => void;
}) {
  return (
    <div className="my-auto flex flex-col gap-4">
      <Alert>
        <CircleAlert aria-hidden />
        <AlertTitle className="line-clamp-none text-base">{title}</AlertTitle>
      </Alert>
      {/* Outside the alert, as before: only the title is announced. */}
      {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
      <Button type="button" size="lg" className="h-12 text-base" onClick={onRetry}>
        {action}
      </Button>
    </div>
  );
}

/** The notice shown in place of the join form once Last Call has closed joining. */
export function Announcement({ shopName, message }: { shopName: string; message: string }) {
  return (
    <div className="my-auto flex flex-col gap-4">
      <h1 className="text-center text-3xl font-semibold tracking-tight">{shopName}</h1>
      <Alert role="status">
        <Clock aria-hidden />
        <AlertTitle className="line-clamp-none text-base">{message}</AlertTitle>
      </Alert>
    </div>
  );
}
