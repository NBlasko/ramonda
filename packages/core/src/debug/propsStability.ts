import { STABLE } from "../helpers/constants";
import { valueEqual } from "../helpers/valueEqual";
import { diagnose } from "./diagnostics";
import { classify, type Kind } from "./renderStability";

/**
 * DEV-only: calls a hook's props callback twice and reports anything that came out
 * different. RMD022 — the same check RMD020 runs on `render()`, on the other place the
 * framework asks the app for a value.
 *
 * ## Why the two belong together
 *
 * `render()` and a props callback are the same kind of thing: code the framework calls,
 * unconditionally, on every render, whose result is compared against the last one. The
 * framework solved that for `render()` — `@memoizedHandler` for functions, `list()` for
 * mapped children — so that writing the natural thing is also the efficient thing. A bag
 * had no such answer, and the churn is not cosmetic: every prop is a signal, so a fresh
 * reference is a change. Measured in core's tests, across three renders of the owner: a
 * hook `@compute` reading a rebuilt array runs three times where one reading a scalar
 * prop runs once, a `@watchProp` on a rebuilt array fires on every update render, and a
 * child component handed a rebuilt function re-renders 3/3.
 *
 * ## Why twice in the same tick, rather than against the previous bag
 *
 * The same reason as RMD020: comparing with the previous render's bag conflates "built
 * inline" with "genuinely changed", and the second is the normal case a bag exists for.
 * Two calls with no state change between them cannot be confused that way — any
 * difference was freshly built.
 *
 * And on EVERY render, not only the first. A callback with an `if` in it only ever proves
 * the branch it took, so a first-render-only check passes the case that breaks later —
 * while reporting the legitimate branch difference as a fault. Blind and noisy at once.
 *
 * ## The hazard, and the switch
 *
 * A callback with a side effect runs it twice. The same position `render()` is held to,
 * for the same reason — a props callback that does more than build an object has a
 * problem this check is describing rather than causing. `configureDev({ strictRender:
 * false })` turns both off; every other diagnostic stays.
 */

const DETAIL: Record<Kind, (owner: string, key: string) => string> = {
  handler: (owner, key) =>
    `\`${owner}\` builds a new function for the \`${key}\` prop on every render — the source is the same, only the identity is fresh.\n` +
    `Every prop is a signal, so a new identity is a change: a \`@compute\` reading it recomputes, a \`@watchProp\` on it fires, and a subscription whose \`connect\` reads it reconnects — on every render of the owner.`,
  object: (owner, key) =>
    `\`${owner}\` builds a new array or object for the \`${key}\` prop on every render, with the same contents.\n` +
    `Every prop is a signal, so a new reference is a change: a \`@compute\` reading it recomputes, a \`@watchProp\` on it fires, and a subscription whose \`connect\` reads it reconnects — on every render of the owner.`,
  nondeterministic: (owner, key) =>
    `\`${owner}\` produced a different value for the \`${key}\` prop from two calls in the same tick, with no state change between them — so the prop does not come from state.\n` +
    `The bag is rebuilt on every render, so this prop holds a different value every time: as a query key, a new cache entry per render and a fetch that never settles.`,
};

const FIX: Record<Kind, string> = {
  handler:
    "A bound method instead of a closure: `fetch: self.load`, where `load()` reads `this.props` when it is called, so there is nothing to capture and the identity never changes. `@memoizedHandler` when it has to be built per argument.",
  object:
    'Wrap it in `stable()`: `key: stable(["user", self.props.id])` keeps one identity for as long as the contents are equal — the counterpart of `list()` for a props bag. A `@compute` holding the whole bag does the same for every value in it at once.',
  nondeterministic:
    "A props callback must be a function of state and props only. Read the value once in `@create` and keep it in `@state` (or `@persist`, so it survives hydration), or read it in the handler that needs it.",
};

/**
 * Compares two bags built by the same callback.
 *
 * `stable()` markers are compared by their contents: two calls in one tick produce two
 * marker objects, and reporting those would report the fix as the fault.
 */
export function checkPropsStability(owner: string, first: unknown, second: unknown): void {
  if (!isBag(first) || !isBag(second)) return;

  for (const key of Object.keys(first)) {
    const a = unwrap(first[key]);
    const b = unwrap(second[key]);

    if (Object.is(a, b)) continue;

    // Both sides came from `stable()`. Equal contents means the framework will hand back
    // one identity, so there is nothing to report; different contents in the same tick is
    // the app being non-deterministic, which is worth saying.
    if (isMarker(first[key]) && isMarker(second[key])) {
      if (!valueEqual(a, b)) report("nondeterministic", owner, key, a, b);
      continue;
    }

    const kind = classify(a, b);
    if (kind) report(kind, owner, key, a, b);
  }
}

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMarker(value: unknown): boolean {
  return typeof value === "object" && value !== null && STABLE in value;
}

function unwrap(value: unknown): unknown {
  return isMarker(value) ? (value as Record<symbol, unknown>)[STABLE] : value;
}

function report(kind: Kind, owner: string, key: string, a: unknown, b: unknown): void {
  diagnose("RMD022", `${owner}:${key}:${kind}`, `${DETAIL[kind](owner, key)}\n\n${FIX[kind]}`, {
    first: a,
    second: b,
  });
}
