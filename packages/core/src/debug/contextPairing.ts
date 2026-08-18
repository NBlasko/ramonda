import { diagnose } from "./diagnostics";

/**
 * RMD057 — a context CONSUMED above the provider that publishes it on the same component.
 *
 * ## What it is
 *
 * A component publishes on its own object, and a consumer resolves its channel ONCE, in its
 * constructor. Hooks are constructed in field-declaration order, so:
 *
 * ```tsx
 * before = this.use(ThemeConsumer);                        // reads the ANCESTOR's value
 * own    = this.use(ThemeProvider, () => ({ … }));
 * ```
 * ```tsx
 * own   = this.use(ThemeProvider, () => ({ … }));
 * after = this.use(ThemeConsumer);                          // reads THIS component's value
 * ```
 *
 * Measured on a component under an ancestor provider: `"ancestor"` in the first spelling, `"mine"` in
 * the second. Two field declarations decide what the page shows.
 *
 * ## Only the first spelling is reported, and that is a measurement rather than a preference
 *
 * The second is `this.use(QueryClientProvider)` followed by `this.use(Query, …)` — mount a client,
 * then query on it — and it is the arrangement `@ramonda/query` and `@ramonda/router` are built
 * around. Reporting it fired **14 times across query's own tests**, all of them on the documented
 * pattern. Reporting only the first fires **nowhere in this repository**.
 *
 * ## And why it is a warning
 *
 * The first spelling has a legitimate reading too — read the outer value and provide a derived one,
 * which works only in this order — and a mistake: a consumer meant to read this component's own
 * value, written one line too early. Nothing here can tell those apart, so this says what it found
 * and leaves the alert alone. `@ramonda/check`'s `context-consumed-above-its-provider` reports the
 * same arrangement before anything runs, including on a branch nobody opened.
 *
 * ## Why the consumer's one-shot lookup is not the thing to change
 *
 * It is what lets RMD003 be reported when the consumer MOUNTS rather than on its first read —
 * including for a value read only down a branch nobody clicked, which is the case that fault ships
 * in. A lazy lookup would move that report to the first read and lose the branch nobody opened.
 *
 * ## Nested hooks are included, deliberately
 *
 * A hook is handed its OWNER's runtime, so a consumer inside a hook inside the providing component
 * resolves on the same object and is the same ambiguity. The report names the component, because the
 * component's field order is what decides it and is where the fix is.
 */

/**
 * Owners that have already constructed a consumer of a given context.
 *
 * A WeakMap rather than a field, per the rule in DIAGNOSTICS.md: debug data must not cost a slot on
 * an object the framework makes many of. Keyed by the owner's runtime, holding the context ids it
 * has consumed — a component may consume several contexts and each is its own question.
 *
 * In this module rather than beside the two call sites so that it does not exist at all in a
 * production build: both callers reach it only from inside `if (__DEV__)`, so the module has no live
 * reference left and goes with them. Measured rather than assumed — bundling `base/Context.ts` with
 * `--define:__DEV__=false` and the dead-code pass on leaves no `consumedBy`, neither probe, no report
 * function, no `diagnose` and neither code. The only `WeakMap` and `hasOwn` in that output belong to
 * `helpers/bindMethods.ts`.
 */
const consumedBy = new WeakMap<object, Set<number>>();

/** Called when a consumer of `contextId` is constructed on `owner`. */
export function recordContextConsumer(owner: object, contextId: number): void {
  const already = consumedBy.get(owner);
  if (already) already.add(contextId);
  else consumedBy.set(owner, new Set([contextId]));
}

/** Whether a consumer of `contextId` was already constructed on `owner`. */
export function hasContextConsumer(owner: object, contextId: number): boolean {
  return consumedBy.get(owner)?.has(contextId) === true;
}

/**
 * The report, raised by the PROVIDER — the only one of the two sites that can see this order.
 *
 * A consumer constructed before the provider cannot know one is coming: the field below it has not
 * run yet. So the consumer records itself and the provider asks.
 *
 * Deduped per context and owning component, so a component says it once however many instances mount.
 */
export function reportConsumedAboveProvider(
  contextId: number,
  holder: string | undefined,
  providerName: string,
  consumerName: string,
): void {
  const subject = holder ? `<${holder} />` : "a component";
  diagnose(
    "RMD057",
    `${contextId}:${holder ?? "?"}`,
    `${subject} uses ${consumerName} above ${providerName}, and a consumer resolves its channel when ` +
      `it is constructed — so it read the nearest provider on an ANCESTOR, not the one this component ` +
      `publishes below it. Swapping the two field declarations changes which value is read.`,
  );
}
