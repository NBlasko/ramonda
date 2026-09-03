import { diagnose } from "./diagnostics";
import { computePhase, renderPhase } from "./renderPhase";
import { displayName } from "../helpers/utils";

/**
 * DEV-only: catches randomness generated while a `render()`, a `@compute`, a
 * `@memoized` builder or a hook's props callback is running.
 *
 * ## Why a second check next to RMD020
 *
 * RMD020 renders twice and compares, so it finds non-determinism only when the two
 * calls produce different values. Measured over 200,000 tries: `Math.random()` and
 * `performance.now()` differ every time, `new Date()` differs every time (a fresh
 * object), and **`Date.now()` differs in 0.006%** — the two renders are microseconds
 * apart, well inside one millisecond.
 *
 * So the double render is blind to a millisecond clock, which is the most common form
 * of the mistake. This check watches the CALL instead of the value, which is reliable
 * regardless of resolution and can name the exact function.
 *
 * ## Why it does NOT patch the clock, though
 *
 * That was the first version, and it was wrong. A patched global catches EVERYONE's
 * calls, not the app's — and the platform reads clocks constantly, behind your back:
 * an `Event` constructor stamps `timeStamp`, which under jsdom is a JS-visible
 * `Date.now()`. Measured, immediately: three of core's own diagnostic tests began
 * failing with RMD021, because reporting any diagnostic during a render dispatches a
 * `CustomEvent` for the devtools log stream, and the constructor read the clock.
 *
 * That is not a bug to suppress, it is the shape of the idea: under jsdom — which is
 * where every app runs its own tests — a clock guard reports things the app never did,
 * attributed to the component that happened to be rendering.
 *
 * **Randomness has no such problem.** Nothing in the platform generates a random
 * number behind your back during a render; `Math.random` and `crypto` are called only
 * because someone asked. So the attribution holds, and this check stays narrow enough
 * to be trusted.
 *
 * ## What covers the clock then
 *
 * - `new Date()` — RMD020, every time, as its `instance` verdict: two calls in one tick
 *   produce two objects, and a fresh identity is the whole question. It never reads the time,
 *   which is why the resolution of the clock does not matter here.
 * - `Date.now()` in a server-rendered app — RMD007, when the hydration disagrees. The
 *   two sides are milliseconds to seconds apart, not microseconds.
 * - `Date.now()` in a client-only app, rendered into the output — **nothing catches
 *   it.** That gap is real and stated rather than papered over. It is the same gap as
 *   `new Date().toISOString()`, measured: both renders land in one millisecond, so the
 *   two strings are equal and there is nothing for a comparison to see.
 */
let installed = false;

/** Patches the sources of randomness. Safe to call more than once. */
export function installPurityGuard(): void {
  if (installed) return;
  installed = true;

  patch(Math, "random", "Math.random()");

  if (typeof crypto !== "undefined") {
    patch(crypto, "randomUUID", "crypto.randomUUID()");
    patch(crypto, "getRandomValues", "crypto.getRandomValues()");
  }
}

function patch(host: object, key: string, label: string): void {
  const target = host as Record<string, unknown>;
  const native = target[key];
  if (typeof native !== "function") return;

  target[key] = function (this: unknown, ...args: unknown[]): unknown {
    report(label);
    return (native as (...a: unknown[]) => unknown).apply(this, args);
  };
}

/**
 * The phase a `@memoized` builder is running in, if any.
 *
 * Its own marker rather than sharing the render one, because the consequence is
 * different: a handler is cached by its arguments, so whatever the builder captured is
 * frozen for as long as the entry lives — and the entry outlives the render that asked
 * for it. A builder is usually called FROM a render, so without this the report would
 * say "while rendering" and point at the wrong fix.
 */
export const memoPhase: { label: string | undefined } = {
  label: undefined,
};

/**
 * The hook whose props callback is running, if any.
 *
 * The bag callback is a pure phase too, and it had no marker — so randomness read while
 * building a bag was reported by nothing. It does not need the callback to run twice to
 * be caught: watching the call is enough, and running a callback twice would double
 * whatever else it does.
 *
 * Its own message, because the cost is the sharpest of the four: the bag is rebuilt on
 * every render, so a random value there is a DIFFERENT value every render. For a query
 * key that means a new cache entry per render and a fetch that never settles.
 */
export const propsPhase: { label: string | undefined } = {
  label: undefined,
};

/**
 * Reports the call, if one of the pure phases is running.
 *
 * Four messages rather than one, because the same call fails differently in each place
 * and the fix differs with it. Checked innermost-first: a compute, a builder or a props
 * callback reached from a render is attributed to the inner one, which is where the
 * value is frozen or rebuilt.
 */
/**
 * Which pure phase is running, innermost first, and what to call it.
 *
 * Split out because two diagnostics ask the same question and must agree on the answer: this one
 * and `RMD061` below. Innermost-first for the reason `report` states — a compute, a builder or a
 * props callback reached from a render belongs to the inner one.
 */
function purePhase(): { phase: "props" | "memo" | "compute" | "render"; label: string } | undefined {
  const props = propsPhase.label;
  if (props !== undefined) return { phase: "props", label: props };

  const building = memoPhase.label;
  if (building !== undefined) return { phase: "memo", label: building };

  const computing = computePhase.label;
  if (computing !== undefined) return { phase: "compute", label: computing };

  const component = renderPhase.component;
  if (component === undefined) return undefined;
  // `displayName`, not `constructor.name`: a class expression assigned to nothing has an empty one,
  // and `<  /> called Math.random()` is a subject a reader cannot act on.
  return { phase: "render", label: displayName(component) };
}

/**
 * A ref BUILT inside one of those phases, which is a mistake whatever the phase.
 *
 * `createRef()` makes a NEW object every call, and a ref is identity — so one built here is a
 * different ref on every render, and the caller has nowhere to keep it. Two costs follow. The child
 * is handed a changed `ref` every time, which IS a props change now (`helpers/arePropsBagsEqual.ts`
 * compares it, and says why), so it re-renders for nothing; and the ref the author meant to read is
 * replaced before they can.
 *
 * One message rather than four, because unlike `RMD021` the fault does not differ by phase: a ref
 * belongs on a field in every one of them. The phase is named so the reader knows where to look.
 */
export function reportRefBuiltInAPurePhase(): void {
  const where = purePhase();
  if (where === undefined) return;

  const inside =
    where.phase === "props"
      ? `while building a hook's props in \`${where.label}\``
      : where.phase === "memo"
        ? `while building the memoised \`${where.label}\``
        : where.phase === "compute"
          ? `while computing \`${where.label}\``
          : `while <${where.label} /> was rendering`;

  diagnose(
    "RMD061",
    `${where.label}:${where.phase}:createRef`,
    `\`createRef()\` was called ${inside}. A ref is an identity, and this one is a new object every time.`,
  );
}

function report(label: string): void {
  const props = propsPhase.label;
  if (props !== undefined) {
    diagnose(
      "RMD021",
      `${props}:props:${label}`,
      `\`${props}\` called ${label} while building a hook's props. The callback is cached on the signals it reads, and this value is not one of them — so it is frozen into the bag until something unrelated invalidates the callback, and then it jumps. For a query key that is an entry which changes on somebody else's state change, and never when this one does.`,
    );
    return;
  }

  const building = memoPhase.label;
  if (building !== undefined) {
    diagnose(
      "RMD021",
      `${building}:memo:${label}`,
      `\`${building}\` called ${label} while building a memoised member — so the value is cached with it, and every call that hits the same cache entry uses the same one.`,
    );
    return;
  }

  const computing = computePhase.label;
  if (computing !== undefined) {
    diagnose(
      "RMD021",
      `${computing}:compute:${label}`,
      `\`${computing}\` called ${label} while computing — and a @compute caches its answer, so the value is frozen until something it READ changes, which may be never.`,
    );
    return;
  }

  const component = renderPhase.component;
  if (component === undefined) return;

  // `displayName` for the reason `purePhase` gives: a nameless class printed `<  /> called …`.
  const name = displayName(component);
  diagnose("RMD021", `${name}:render:${label}`, `<${name} /> called ${label} while rendering.`);
}
