"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { dictionaries } from "@/lib/i18n";
import "./globals.css";

/**
 * The last resort when rendering itself fails. A render error is caught by this
 * boundary rather than reaching the browser's global handlers, so it is reported
 * here or not at all.
 *
 * It replaces the root layout, so it cannot know the Customer's language and says
 * everything in both.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const { en, ms } = dictionaries;

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold">
          {en.joinFailed}
          <span className="block text-base font-normal text-muted-foreground">
            {ms.joinFailed}
          </span>
        </h1>
        <Button onClick={() => retry()}>
          {en.tryAgain} · {ms.tryAgain}
        </Button>
      </body>
    </html>
  );
}
