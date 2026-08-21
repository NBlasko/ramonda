/**
 * DEV-only diagnostics, emitted as a record rather than as a sentence.
 *
 * A string carries the fault to a human and nowhere else: a collector cannot
 * filter it by severity, group it by cause, or count it, without parsing prose.
 * So every report here produces a `RamondaDiagnostic` — code, severity, message,
 * fix, structured data — printed to the console AND handed to whatever sink is
 * installed. See `env.d.ts` for the shape and https://ramonda.dev/reference/diagnostics.
 *
 * ## Nothing is deduplicated, deliberately
 *
 * Core's diagnostics dedupe because they fire once per render for a fixed piece
 * of code, so the second report carries nothing new. A missed path here is
 * data-dependent: the same call site can miss for one record and hit for the
 * next, and collapsing those would hide the case that actually matters.
 * Repetition is the signal — which is why no report below sets `dedupKey`.
 *
 * ## Every code here means the write did not happen
 *
 * The value handed back is the original root, unchanged and uncopied. What the
 * severity separates is whether the CODE can be right:
 *
 * - **error** — it cannot be, whatever the data holds. A wrong kind of value for
 *   the operation, a refused key, a branch that returns nothing.
 * - **warn** — it may well be, and the data was simply empty or absent. A path
 *   through a `null`, a predicate that matched nothing, a key already gone.
 *
 * A path steps THROUGH a nullable value by design, so reporting that as an error
 * would alarm a devtools panel about a program doing exactly what it was written
 * to do.
 */

/**
 * One diagnostic, in the shape a collector can group and filter — the Ramonda
 * Diagnostic Record.
 *
 * Declared here rather than imported, and that is the whole design: a package
 * that reports something must stay free of dependencies, so the contract is the
 * SHAPE and the name of the sink, not a module. Any library can emit into the
 * same channel by writing these lines, whether or not it knows about Ramonda.
 *
 * Ambient rather than exported, so it travels with the source to every project
 * that compiles it — this file is type-checked by the docs app too, which has its
 * own `env.d.ts` and no reason to know about ours. Two packages declaring it
 * identically merge; that they stay identical is what the conformance test in
 * each package is for.
 *
 * The field names line up with OpenTelemetry's log data model, so bridging to a
 * collector is a rename rather than a redesign.
 * https://ramonda.dev/reference/diagnostics#capturing-them
 */
declare global {
  interface RamondaDiagnostic {
    /** Stable forever. The prefix says which package: `RML` is `@ramonda/lens`. */
    code: string;
    /** Who emitted it. OpenTelemetry calls this `InstrumentationScope.name`. */
    scope: string;
    /** `debug` · `info` · `warn` · `error`, mapping to SeverityNumber 5 · 9 · 13 · 17. */
    severity: "debug" | "info" | "warn" | "error";
    /** One sentence, human first. Interpolated values are fine — grouping is by `code`. */
    message: string;
    /** What to do instead. Always concrete, and always present for an `error`. */
    fix?: string;
    /** The values the message interpolated, structured. What a collector queries. */
    data?: Record<string, unknown>;
    /** Epoch millis. Sortable, comparable, locale-free. */
    time: number;
    /** Identifies the SOURCE of a fault. Absent means "never deduplicate this". */
    dedupKey?: string;
  }

  /**
   * The sink, installed by a collector and by nobody else.
   *
   * `globalThis` rather than an event on `window`, so the same line works in the
   * browser, in Node, in a worker and during a server render. Absent almost
   * always, which is why the call site is `?.()` — one property read.
   */
  var __RAMONDA_DIAGNOSTICS__: ((record: RamondaDiagnostic) => void) | undefined;
}

/**
 * The registry. One code per fault CLASS — a cause with a single fix — not one
 * per sentence, so `at` on a non-array and `where(…).remove()` on a non-array are
 * one code with two messages rather than two codes with one fix each.
 *
 * A code is never reused once retired, and the docs reference has a section for
 * every one of them; `check-api-coverage.mjs` fails the build otherwise.
 *
 * The union in `Spec` is the gate on quality that a review cannot be: an `error`
 * without a `fix` does not compile.
 */
type Spec =
  | { readonly severity: "error"; readonly fix: string }
  | { readonly severity: "debug" | "info" | "warn"; readonly fix?: string };

/**
 * Listed as a union rather than inferred from the table below, because the table
 * has to be behind `__DEV__` — see there — and a `keyof typeof` of a conditional
 * is not a list of codes.
 */
export type LensCode =
  | "RML001"
  | "RML002"
  | "RML003"
  | "RML004"
  | "RML005"
  | "RML006"
  | "RML007"
  | "RML008"
  | "RML009"
  | "RML010"
  | "RML011";

/**
 * Behind the flag, and this is load-bearing rather than tidy.
 *
 * Every call site is inside `if (__DEV__)`, so `report` is unreachable in a
 * production build — and the bundler drops the function but **keeps the table**.
 * Measured with esbuild `--minify --define:__DEV__=false`: reading `SPECS` from
 * `report`'s body took the bundle from 3736 to 5945 bytes raw, 1378 to 2378
 * gzipped, for text no shipped code can reach. Tree-shaking is one reachability
 * pass over top-level symbols; dropping `report` does not send it back to
 * reconsider what `report` was the only reader of.
 *
 * A conditional whose test folds to `false` needs no such pass: the literal is
 * gone at parse time. Verified the same way — 1.39 KB gzipped with it, against
 * 1.19 KB for the package before any of this, the difference being the
 * production-side key guard rather than a single word of this table.
 */
const SPECS: Record<LensCode, Spec> = __DEV__
  ? {
      RML001: {
        severity: "warn",
        fix:
          "Only the LAST hop creates what it names, so a gap before it cannot be walked through. Set " +
          "the intermediate value first, or `merge` the whole object into place.",
      },
      RML002: {
        severity: "error",
        fix:
          "Its contents live in internal slots that a copy cannot reach, so a path cannot descend into " +
          "one. Read the value out, rebuild it, and `set` the result.",
      },
      RML003: {
        severity: "error",
        fix: "Use `get(key)` for an object. The array hops exist only where the focused value is an array.",
      },
      RML004: {
        severity: "warn",
        fix:
          "A negative index counts from the end, so `at(-1)` is the last element. `insert` accepts " +
          "`length` itself — that is an append — and `push` says the same thing more plainly.",
      },
      RML005: {
        severity: "warn",
        fix:
          "Reading the same path with `values()` shows what is actually there. A stale id and a " +
          "comparison against the wrong field both look like this.",
      },
      RML006: {
        severity: "error",
        fix:
          "`push` and `insert` need an array — a missing or `null` one counts as empty, anything else " +
          "does not. `merge` needs an object and does not create one, because a `Partial` cannot fill a " +
          "whole one; `set` is the operation that creates.",
      },
      RML007: {
        severity: "warn",
        fix: "Check the hop before the one being removed, and the spelling of the key — a typo reads the same way.",
      },
      RML008: {
        severity: "error",
        fix:
          "A branch has to RETURN its terminal operation, because what it returns is what replaces the " +
          'focused value: `(post) => post.get("title").set("x")`, not ' +
          '`(post) => { post.get("title").set("x") }`.',
      },
      RML009: {
        severity: "error",
        fix:
          "Those keys reach an object's own machinery rather than its data — assigning to `__proto__` " +
          "replaces the copy's prototype instead of setting a property. If the key came from data, " +
          "filter it before building the path.",
      },
      RML010: {
        severity: "error",
        fix:
          "`focusOn(root)` captures `root` once, so a second write would be computed from the ORIGINAL " +
          "value and would silently drop the first edit. Feed the result back in — " +
          "`focusOn(next).…` — or make one `and` of the edits.",
      },
      RML011: {
        severity: "error",
        fix:
          "Removal needs the container holding the value, and the root has none. Focus the property or " +
          "element to drop first.",
      },
    }
  : ({} as Record<LensCode, Spec>);

/**
 * Reports one diagnostic: to the console, and to a collector if one installed a sink.
 *
 * `data` is for values, never for live objects. A collector keeps a bounded
 * history, and a record holding a component or a DOM node would keep it alive for
 * as long as that history does.
 *
 * The guard is INSIDE, as well as at every call site. It is not redundant: the
 * bundler keeps this declaration whatever the call sites fold to — the same
 * single-pass reachability that keeps `SPECS` above — so what it can be made to
 * keep is an empty shell rather than a body. Measured on the production bundle:
 * 4049 bytes raw with the bodies exposed, 3752 with them behind the flag, and
 * 3736 with these three functions deleted outright. Sixteen bytes for the shells,
 * against three hundred for what they contained.
 */
export function report(code: LensCode, message: string, data?: Record<string, unknown>): void {
  if (!__DEV__) return;
  const spec: Spec = SPECS[code];

  globalThis.__RAMONDA_DIAGNOSTICS__?.({
    code,
    scope: "ramonda/lens",
    severity: spec.severity,
    message,
    fix: spec.fix,
    data,
    time: Date.now(),
  });

  console[spec.severity === "error" ? "error" : "warn"](printed(code, message));
}

/** The console form, shared so a thrown message reads exactly like a printed one. */
function printed(code: LensCode, message: string): string {
  if (!__DEV__) return "";
  const spec: Spec = SPECS[code];
  return `[Ramonda lens ${code}] ${message}${spec.fix === undefined ? "" : `\n\n→ ${spec.fix}`}`;
}

/**
 * Reports a diagnostic and returns the Error to throw, so the panel sees the
 * fault a throw would otherwise keep to itself.
 *
 * The two callers are the faults where carrying on would produce a plausible
 * result that is quietly wrong, which is why they are errors rather than reports.
 * In production they are compiled out entirely and the operation is a no-op — so
 * neither is control flow to rely on.
 */
export function fatal(code: LensCode, message: string, data?: Record<string, unknown>): Error {
  report(code, message, data);
  return new Error(printed(code, message));
}
