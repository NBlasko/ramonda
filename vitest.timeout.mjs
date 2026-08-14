/**
 * How long a test may take before it is called hung, decided once.
 *
 * **A per-test timeout is a claim about the MACHINE, not about the code.** Nothing in this
 * repository asserts a duration — every case is a DOM fact, a returned value or a recorded call —
 * so the only thing this number can catch is a test that never finishes. Set close to how long
 * tests actually take, it catches something else instead: whatever else the machine was doing.
 *
 * Measured on 2026-08-14, each file alone and then inside `turbo run test`, which is what CI runs:
 *
 * ```
 * form/Surgical.test.tsx         3.80 s alone (1.07 s in the tests)   18.6 s under load
 * form/Bookkeeping.test.tsx      3.60 s alone (0.51 s in the tests)   10.9 s under load
 * devtools/diagnostics.test.ts   6.01 s alone                         25.7 s under load
 * ```
 *
 * The two slow cases in `diagnostics.test.ts` take 2413 ms and 1723 ms on an idle machine while the
 * other twenty-two in that file take 0–24 ms: both mount the panel, which builds a shadow tree, and
 * jsdom charges for all of it. `form` spends 31.69 s on environment setup across 17 files against
 * 8.14 s in the tests themselves. None of that is a defect; it is what these tests cost.
 *
 * **This has already been got wrong once, in the direction of not enough headroom.**
 * `@ramonda/devtools` set 20 s against a then-worst case of 894 ms and called it "deliberately far
 * more than the contention seen" — and it failed at 25.7 s, because the repository grew from 25
 * concurrent tasks to 45 and the contention grew with it. A number chosen as a multiple of today's
 * worst case expires. This one is chosen to be irrelevant until something is actually wrong.
 *
 * It cannot hide a regression: a test that starts taking a minute has stopped being one of these,
 * and the suite's own duration is printed on every run. What it removes is a flake — and a flake in
 * a gate is worse than a slow gate, because it teaches everyone to re-run instead of to look.
 */
export const testTimeout = 60_000;

/**
 * The same argument for `beforeAll`/`afterAll`, which is where a jsdom environment and a built
 * bundle are set up. Left at the default, a hook is the tighter gate of the two and fails first.
 */
export const hookTimeout = 60_000;
