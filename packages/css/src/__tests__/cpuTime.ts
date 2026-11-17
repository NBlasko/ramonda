import { isMainThread } from "node:worker_threads";

/**
 * The fewest milliseconds of CPU this process spent on `run`, over three runs.
 *
 * CPU, not the clock, because a process waiting for a core spends no CPU while it waits: timed by the
 * clock, a reading of 12 ms measured 254 under a full gate's load. CPU still grows there — coverage
 * makes a reading about five times dearer, and a shared core runs slower — so an input has to be long
 * enough that its quadratic reading costs many times its linear one; see `linearTime.test.ts`. The
 * fewest of three, because the first run also pays for compiling what it calls.
 *
 * `process.cpuUsage()` counts every thread of the process, so this asks for a process of the test
 * file's own: vitest's `forks` pool. Under `threads` it would count the other files too.
 */
export function cpuTime(run: () => unknown): number {
  if (!isMainThread) throw new Error("cpuTime counts the whole process; run this file in vitest's `forks` pool");
  let fewest = Number.POSITIVE_INFINITY;
  for (let one = 0; one < 3; one++) {
    const before = process.cpuUsage();
    run();
    const spent = process.cpuUsage(before);
    fewest = Math.min(fewest, (spent.user + spent.system) / 1000);
  }
  return fewest;
}
