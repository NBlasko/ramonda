import { isMainThread } from "node:worker_threads";

/**
 * The fewest milliseconds of CPU this process spent on a run, over three runs — each on an input of its own.
 *
 * CPU, not the clock, because a process waiting for a core spends no CPU while it waits: timed by the
 * clock, a reading of 12 ms measured 254 under a full gate's load. CPU still grows there — coverage
 * makes a reading about five times dearer, and a shared core runs slower — so an input has to be long
 * enough that its quadratic reading costs many times its linear one; see `linearTime.test.ts`. The
 * fewest of three, because the first run also pays for compiling what it calls.
 *
 * **Each round reads an input of its own**: `input` is handed the round to make one, and only `read`
 * is timed — building a 160,000-character string is work of its own, not the reading's. The compiler
 * remembers answers by input, so the same input asked twice is answered from memory: with the
 * quadratic `!important` strip planted back, `font-family: Helvetica<20,000 spaces>Neue` cost 494 ms
 * the first time and 27 ms the second, and the fewest of three measured the memory.
 *
 * `process.cpuUsage()` counts every thread of the process, so this asks for a process of the test
 * file's own: vitest's `forks` pool. Under `threads` it would count the other files too.
 */
export function cpuTime<T>(input: (round: number) => T, read: (input: T) => unknown): number {
  if (!isMainThread) throw new Error("cpuTime counts the whole process; run this file in vitest's `forks` pool");
  let fewest = Number.POSITIVE_INFINITY;
  for (let round = 0; round < 3; round++) {
    const made = input(round);
    const before = process.cpuUsage();
    read(made);
    const spent = process.cpuUsage(before);
    fewest = Math.min(fewest, (spent.user + spent.system) / 1000);
  }
  return fewest;
}
