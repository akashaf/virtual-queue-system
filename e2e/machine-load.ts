import { availableParallelism, loadavg } from "node:os";

/**
 * Runs at a load of 20 or more on 8 cores lost tests to timeouts; one that started
 * under 10 passed 40 of 40 (#31). Twice the core count sits between the two.
 */
const BUSY_LOAD_PER_CORE = 2;

/** The machine's 1-minute load average now, and whether it is too busy to trust a timeout. */
export function machineLoad() {
  const [load] = loadavg();
  const cores = availableParallelism();
  return {
    busy: load > cores * BUSY_LOAD_PER_CORE,
    summary: `load average ${load.toFixed(1)} on ${cores} cores`,
  };
}
