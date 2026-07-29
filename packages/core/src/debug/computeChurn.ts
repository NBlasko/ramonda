import { diagnose } from "./diagnostics";
import { valueEqual } from "../helpers/valueEqual";

/**
 * DEV-only: RMD024 — a `@compute` that recomputes over and over and keeps producing the same
 * answer.
 *
 * ## What it catches, and why nothing else can
 *
 * A compute is invalidated by the signals it READ. If one of those is a rebuilt reference — an
 * array literal in a hook's props bag, a fresh object handed down as a prop — the compute is
 * invalidated on every render and recomputes to the same value. Its cache does nothing, and
 * the work is silent: the answer is correct, so nothing looks wrong.
 *
 * The two checks either side of this cannot see it:
 *
 * - **RMD020** renders twice and compares. Inside one strict render the compute is CACHED
 *   between the two calls, so both get the same value and there is nothing to report.
 * - **RMD022** compares two props bags, but skips a prop the hook declared with
 *   `@StableProps` or the call site wrapped in `stable()` — and a compute reading a *component*
 *   prop, or another compute, is outside its reach entirely.
 *
 * It also catches the case no reference check can: an app's own counter. `@compute get x() {
 * return seq++ }` recomputes forever without any prop being rebuilt.
 *
 * ## Why consecutive runs, and why three
 *
 * One recompute that returns an equal value is ordinary — a dependency moved and the answer
 * happened not to change. Three in a row is a pattern: something this compute reads is being
 * replaced on every pass. Below three, real code would be reported for coincidences.
 *
 * ## The cost
 *
 * One bounded `valueEqual` per recompute, in development only, and only against the previous
 * value — the same comparison RMD020 uses, at depth 2. A compute that is genuinely
 * recomputing rarely pays it rarely.
 */

/** How many consecutive equal recomputes count as churn rather than coincidence. */
const RUNS = 3;

interface Churn {
  previous: unknown;
  equalRuns: number;
}

const churn = new WeakMap<object, Map<string, Churn>>();

/**
 * Records one recompute and reports when the pattern is clear.
 *
 * Keyed by instance and member, not by the cache object: two instances of the same component
 * are two different questions, and one of them churning says nothing about the other.
 */
export function recordCompute(instance: object, member: string, value: unknown): void {
  let members = churn.get(instance);
  if (members === undefined) {
    members = new Map();
    churn.set(instance, members);
  }

  const seen = members.get(member);
  if (seen === undefined) {
    members.set(member, { previous: value, equalRuns: 0 });
    return;
  }

  if (!valueEqual(seen.previous, value)) {
    seen.previous = value;
    seen.equalRuns = 0;
    return;
  }

  seen.previous = value;
  seen.equalRuns++;
  if (seen.equalRuns < RUNS) return;

  // Reported once per compute: the dedup key is the member, and the point is made the first
  // time. Reset so a later burst after a genuine change reports again.
  seen.equalRuns = 0;

  const owner = instance.constructor.name;
  diagnose(
    "RMD024",
    `${owner}.${member}`,
    `\`${owner}.${member}\` recomputed ${RUNS + 1} times in a row and produced an equal value every time, so its cache is doing nothing.\n` +
      `A @compute is invalidated by the signals it READ, so something it reads is being replaced on every pass — usually an array or object literal rebuilt in a props bag, or a value derived from one.`,
  );
}
