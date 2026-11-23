import { isMainThread } from "node:worker_threads";

/**
 * The fewest milliseconds of CPU this process spent on a run, over three runs — each on an input of its own.
 *
 * The same measure `@ramonda/css`'s timing tests use (its `__tests__/cpuTime.ts`), written here again
 * because one package's tests do not import another's. CPU, not the clock: a process waiting for a core
 * spends no CPU while it waits, so a loaded gate does not inflate it the way it inflated the clock — the
 * "number that never ends" case measured 550 ms by the clock inside a gate and -45 ms alone. CPU still
 * grows under coverage and on a shared core, so a bound sits far from both a linear and a quadratic cost.
 *
 * **Each round reads an input of its own**: `input` is handed the round to make one, and only `read` is
 * timed — writing a project to disk is work of its own, not the reading's.
 *
 * `process.cpuUsage()` counts every thread of the process, so this needs a process of the test file's
 * own: vitest's `forks` pool, the default. Under `threads` it would count the other files too.
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
