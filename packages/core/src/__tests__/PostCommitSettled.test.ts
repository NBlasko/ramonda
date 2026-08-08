import { describe, test, expect } from "vitest";
import { queueAfterCommit, hasPendingPostCommit, flushAfterCommit } from "../core/commit";

/**
 * "Settled" has to mean BOTH post-commit fronts are empty — the per-component
 * `@mounted` queue AND the commit-level work `queueAfterCommit` holds (a `Head`
 * or `Portal` recompute).
 *
 * The synchronous drain a test harness runs, and `resumeIfWorkRemains`, decide
 * whether to keep going from `hasPendingPostCommit()`. If it reports empty while
 * commit-level work is still queued — work reached after the last
 * `flushPostCommit`, so nothing drains it — the head update is stranded until an
 * unrelated later commit happens to flush it.
 */
describe("hasPendingPostCommit accounts for commit-level work", () => {
  test("is true while commit-level work is queued, false once flushed", () => {
    // A clean slate — nothing else queued this from a prior test.
    flushAfterCommit();
    expect(hasPendingPostCommit()).toBe(false);

    queueAfterCommit(() => {});
    expect(hasPendingPostCommit()).toBe(true);

    flushAfterCommit();
    expect(hasPendingPostCommit()).toBe(false);
  });
});
