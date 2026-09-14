import { headers } from "next/headers";
import { CheckForm } from "./check-form";
import { readAfterRecord, storeBackend } from "./store";

// Throwaway (#3): verifies proxy.ts, Server Actions and after() on the deployed site.
// Once the findings are recorded on the issue, remove: app/platform-check/, proxy.ts,
// e2e/platform-check.spec.ts, the E2E_BASE_URL switch in playwright.config.ts and the
// @netlify/blobs dependency.
export default async function PlatformCheckPage() {
  const proxyRuntime = (await headers()).get("x-platform-check-proxy-runtime");
  const afterRecord = await readAfterRecord();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">Platform check</h1>
      <p data-testid="proxy">
        {proxyRuntime ? `Proxy: ran on ${proxyRuntime}` : "Proxy: did not run"}
      </p>
      <CheckForm />
      <p data-testid="after">
        {afterRecord
          ? `after(): completed at ${afterRecord.completedAt} for run ${afterRecord.runId}`
          : "after(): no record yet"}
      </p>
      <p data-testid="store" className="text-sm text-muted-foreground">
        Store: {storeBackend()}
      </p>
    </main>
  );
}
