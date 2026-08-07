/**
 * The form package's own reporting.
 *
 * Two of its three codes are not diagnostics at all: assigning to a field and asking a
 * non-list field for its rows **throw**, in every build, because there is no correct program
 * in which either does something. So this module has two doors, and which one a code uses
 * follows from that — see `refuse`.
 *
 * The record is the protocol every reporting package shares, documented at
 * https://ramonda.pages.dev/reference/diagnostics#capturing-them. It is declared here rather
 * than imported, and that is the whole design: a package that reports something must be free
 * to have no dependencies, so what is shared is the SHAPE and the name of the sink, never a
 * module. `@ramonda/devtools` compares these declarations across packages, which is what keeps
 * the copies honest.
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

export type FormCode = "RMF001" | "RMF002" | "RMF003";

/**
 * Behind the flag, so a published build carries none of this text.
 *
 * Every reporting path below is inside `if (__DEV__)`, and a bundler drops the functions while
 * KEEPING a table only those functions read — measured in `@ramonda/lens`, where the same table
 * cost 2.2 KB of prose no shipped code could reach. A conditional whose test folds to `false`
 * needs no reachability pass at all.
 *
 * The advice a THROW carries is not here: it ships, so it lives in `REFUSAL`.
 */
const SPECS: Record<FormCode, Spec> = __DEV__
  ? {
      RMF001: {
        severity: "error",
        fix:
          "A field node is a proxy over a path, not a place values live, so the assignment would land " +
          "on the proxy and stop there. `set` records the change where the form can see it.",
      },
      RMF002: {
        severity: "error",
        fix:
          "`length`, `rows`, `append`, `insert` and `remove` belong to an array field. An absent field " +
          "is not this: `undefined` and `null` read as an empty list, so only a value that is present " +
          "and is not an array is refused.",
      },
      RMF003: {
        severity: "error",
        fix:
          "The form calls `onSubmit` from a DOM submit event, where nobody is waiting on the promise it " +
          "returns — so a failure there is the app's to handle. Catch it inside the handler and turn it " +
          "into a message, a retry or a redirect.",
      },
    }
  : ({} as Record<FormCode, Spec>);

/**
 * The text the two refusals throw with, in EVERY build.
 *
 * Here rather than at the call sites so that one code has one sentence: the message a production
 * user sees is the same one the record carries, and there is no second copy to drift.
 */
export const REFUSAL = {
  RMF001: "A field cannot be assigned to. Use `.$.set(value)`, which records the change where the form can see it.",
  RMF002: (path: string, kind: string) =>
    `\`${path || "the root"}\` holds a ${kind}, so it has no rows. The list members are for an array field.`,
} as const;

/**
 * Reports a diagnostic: a record for a collector, and a line for the console.
 *
 * For `RMF003`, which is a diagnostic and nothing else — the submit already failed, the form has
 * let go of it, and this is the only trace.
 */
export function report(code: FormCode, message: string, data?: Record<string, unknown>, cause?: unknown): void {
  if (!__DEV__) return;

  const spec: Spec = SPECS[code];

  globalThis.__RAMONDA_DIAGNOSTICS__?.({
    code,
    scope: "ramonda/form",
    severity: spec.severity,
    message,
    fix: spec.fix,
    data,
    time: Date.now(),
  });

  const printed = `[Ramonda form ${code}] ${message}${spec.fix === undefined ? "" : `\n\n→ ${spec.fix}`}`;

  /**
   * `cause` goes to the console and NOT into the record, and the asymmetry is the point.
   *
   * `RMF003` is handed the error `onSubmit` threw, and a console given the Error itself prints a
   * stack a developer can click — a `String(error)` cannot. But a record is kept in a collector's
   * bounded history, and an Error holds its stack, which holds the scope it was thrown from: one
   * of these in a vault keeps a whole submit alive. So the record gets the message as text under
   * `data`, and the live object goes only where nothing retains it.
   */
  if (cause === undefined) console.error(printed);
  else console.error(printed, cause);
}

/**
 * Records a refusal and returns the error to throw. It does NOT print.
 *
 * The difference from `report` is the reason these two exist: their throw happens in every build,
 * so the message is already in front of the developer — printing it as well would make development
 * noisier than production for the same fault, and say nothing extra. What development adds is the
 * RECORD, so a panel sees a refusal that a caught `TypeError` would otherwise keep to itself.
 */
export function refuse(code: "RMF001" | "RMF002", message: string, data?: Record<string, unknown>): TypeError {
  if (__DEV__) {
    globalThis.__RAMONDA_DIAGNOSTICS__?.({
      code,
      scope: "ramonda/form",
      severity: "error",
      message,
      fix: SPECS[code].fix,
      data,
      time: Date.now(),
    });
  }

  return new TypeError(`[Ramonda form ${code}] ${message}`);
}
