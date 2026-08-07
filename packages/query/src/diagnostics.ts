/**
 * The query package's own reporting: a record for a collector, and a line for the console.
 *
 * Separate from core's `diagnose` because these codes are this package's, and because a cache
 * diagnostic has no component to attribute itself to — what identifies it is the KEY. Same
 * shape otherwise: DEV only at every call site, one report per distinct cause, and a reset for
 * tests.
 *
 * The record is the protocol every reporting package shares, documented at
 * https://ramonda.pages.dev/reference/diagnostics#capturing-them. It is declared here rather
 * than imported, and that is the whole design: a package that reports something must be free
 * to have no dependencies, so what is shared is the SHAPE and the name of the sink, never a
 * module. Each package's suite asserts the shape it produces, and `@ramonda/devtools` compares
 * the declarations across packages, which is what keeps the copies honest.
 */
declare global {
  interface RamondaDiagnostic {
    code: string;
    scope: string;
    severity: "debug" | "info" | "warn" | "error";
    message: string;
    fix?: string;
    data?: Record<string, unknown>;
    time: number;
    dedupKey?: string;
  }

  var __RAMONDA_DIAGNOSTICS__: ((record: RamondaDiagnostic) => void) | undefined;
}

/** An `error` promises a fix, and the union is what makes that a compile error rather than a review note. */
type Spec =
  | { readonly severity: "error"; readonly fix: string }
  | { readonly severity: "debug" | "info" | "warn"; readonly fix?: string };

export type QueryCode = "RMQ001" | "RMQ002";

/**
 * Behind the flag, and it has to be: every call site is inside `if (__DEV__)`, so `report` is
 * unreachable in a published build — and a bundler drops the function while KEEPING a table only
 * that function read. Measured in `@ramonda/lens`, where the same table cost 2.2 KB of text no
 * shipped code could reach. A conditional whose test folds to `false` needs no reachability pass.
 *
 * Both of these are errors by the rule on the reference page: the end result is wrong, and someone
 * acts on data that is not what they asked for.
 */
const SPECS: Record<QueryCode, Spec> = __DEV__
  ? {
      RMQ001: {
        severity: "error",
        fix:
          "A key has to be JSON-serializable and stable across renders. Put a primitive in it — the " +
          "id, or `date.toISOString().slice(0, 10)` — and keep the object or the function in the fetcher.",
      },
      RMQ002: {
        severity: "error",
        fix:
          "Read `isError`, `error`, `status` or `result` so the reader learns something went wrong — a " +
          "failed refetch keeps the data it had, so the page may look fine while showing values nobody " +
          "can refresh. If the failure means the page cannot be shown at all, return your own markup " +
          "for it (`if (q.isError) return <NotFound />`) rather than letting an error boundary unmount " +
          "the subtree.",
      },
    }
  : ({} as Record<QueryCode, Spec>);

/**
 * One report per distinct cause, not per occurrence.
 *
 * A key is hashed on every render, so an unstable one would report on every pass — and a warning
 * that repeats forever is one people scroll past. The `dedupKey` a caller passes IS what the record
 * publishes, so a collector that dedupes sees exactly the grouping this package chose.
 */
const reported = new Set<string>();

export function report(code: QueryCode, message: string, dedupKey: string, data?: Record<string, unknown>): void {
  if (!__DEV__) return;

  const seen = `${code}:${dedupKey}`;
  if (reported.has(seen)) return;
  reported.add(seen);

  const spec: Spec = SPECS[code];

  globalThis.__RAMONDA_DIAGNOSTICS__?.({
    code,
    scope: "ramonda/query",
    severity: spec.severity,
    message,
    fix: spec.fix,
    data,
    time: Date.now(),
    dedupKey: seen,
  });

  console.error(`[Ramonda query ${code}] ${message}${spec.fix === undefined ? "" : `\n\n→ ${spec.fix}`}`);
}

/** Clears the dedup set. For tests, mirroring core's `resetDiagnostics`. */
export function resetQueryDiagnostics(): void {
  reported.clear();
}
