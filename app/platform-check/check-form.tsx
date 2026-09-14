"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { runCheck, type CheckResult } from "./actions";

export function CheckForm() {
  const [result, formAction, pending] = useActionState<CheckResult>(runCheck, null);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button type="submit" disabled={pending}>
        Run Server Action
      </Button>
      <p data-testid="action">
        {result
          ? `Server Action: ran at ${result.ranAt} on Node ${result.node} (run ${result.runId})`
          : "Server Action: not run yet"}
      </p>
    </form>
  );
}
