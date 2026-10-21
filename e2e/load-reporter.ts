import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { machineLoad } from "./machine-load";

/**
 * Attaches the machine's load to every failed test, since a run that starts quiet can turn
 * busy partway through (#38). Reporters share each result, so a text attachment is printed
 * with the failure's summary and kept in any report; it is listed first so that even a
 * reporter reading results as they arrive sees it.
 */
export default class LoadReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === test.expectedStatus || result.status === "skipped") return;
    const { busy, summary } = machineLoad();
    const verdict = busy
      ? "busy: a timeout here is likely the machine, not the code. Rerun once it settles."
      : "quiet.";
    result.attachments.push({
      name: "machine load",
      contentType: "text/plain",
      body: Buffer.from(`${summary} when this test failed; ${verdict}`),
    });
  }

  printsToStdio() {
    return false;
  }
}
