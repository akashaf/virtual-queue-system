import { machineLoad } from "./machine-load";

/**
 * Prints the load before every run, and warns on a busy machine, whose timeouts read
 * like a regression (docs/agents/gotchas.md, "A busy Mac fails e2e tests").
 */
export default function globalSetup() {
  const { busy, summary } = machineLoad();
  console.log(`e2e: ${summary}`);
  if (busy) {
    console.warn(
      `\n⚠ e2e: that is busy. Timeouts in this run are likely the machine, not the code. ` +
        `Wait for it to settle, or compare against ` +
        `\`git stash\` back to back.\n`,
    );
  }
}
