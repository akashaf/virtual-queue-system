import { availableParallelism, loadavg } from "node:os";

/**
 * Runs at a load of 20 or more on 8 cores lost tests to timeouts; one that started
 * under 10 passed 40 of 40 (#31). Twice the core count sits between the two.
 */
const BUSY_LOAD_PER_CORE = 2;

/**
 * Prints the load before every run, and warns on a busy machine, whose timeouts read
 * like a regression (docs/agents/gotchas.md, "A busy Mac fails e2e tests").
 */
export default function globalSetup() {
  const [load] = loadavg();
  const cores = availableParallelism();
  console.log(`e2e: load average ${load.toFixed(1)} on ${cores} cores`);
  if (load > cores * BUSY_LOAD_PER_CORE) {
    console.warn(
      `\n⚠ e2e: that is busy. Timeouts in this run are likely the machine, not the code. ` +
        `Wait for it to settle, or compare against ` +
        `\`git stash\` back to back.\n`,
    );
  }
}
