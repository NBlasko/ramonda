import { autoCleanupOn, cleanup } from "./cleanup";

/**
 * A development diagnostic fails the test it happened in.
 *
 * Ramonda's diagnostics are printed, not thrown — a page that works but costs too much must keep
 * working — and a test runner hides a passing test's console. So a test could cause RMD020 on every
 * run, pass, and say nothing: found by an agent building an app from the docs alone, which saw the
 * report only in a browser. One of the three it had missed was a real bug in its own harness.
 *
 * Collected from `__RAMONDA_DIAGNOSTICS__`, the one sink every Ramonda package reports through, and
 * only what Ramonda reported (a `ramonda/` scope) at `warn` or `error`. Another listener already on the
 * global is called as well, never replaced: dropping it silently is the fault the protocol exists to
 * expose.
 */
interface Report {
  code: string;
  scope?: string;
  severity?: string;
  message?: string;
  fix?: string;
}

let seen: Report[] = [];
const allowed = new Set<string>();
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  const existing = globalThis.__RAMONDA_DIAGNOSTICS__;
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => {
    seen.push(record as Report);
    existing?.(record);
  };
}

/**
 * Lets this test cause these diagnostics without failing — for a test that exists to show one.
 *
 * Per test: what one test allows, the next does not. Name the code, so a different mistake in the
 * same test still fails it.
 */
export function allowDiagnostics(...codes: string[]): void {
  for (const code of codes) allowed.add(code);
}

/** Before a test: nothing seen, nothing allowed, and every diagnostic able to be reported again. */
export function startTest(): void {
  seen = [];
  allowed.clear();
  // A diagnostic is said once per process. Without this, the first test to make a mistake takes the
  // only report, and every later test making it passes in silence. Each package hands over its own way
  // to forget, in one global set — core's, `@ramonda/query`'s — so this depends on none of them.
  for (const forget of globalThis.__RAMONDA_DIAGNOSTICS_RESET__ ?? []) forget();
}

/** What this test reported that it did not allow, as the error that fails it — and takes it. */
export function diagnosticsFailure(): Error | undefined {
  const found = seen.filter(
    (r) =>
      r.scope?.startsWith("ramonda/") === true &&
      (r.severity === "warn" || r.severity === "error") &&
      !allowed.has(r.code),
  );
  seen = [];
  if (found.length === 0) return undefined;

  const lines = found.map((r) => `  [${r.code}] ${r.message ?? ""}${r.fix ? `\n    → ${r.fix}` : ""}`);
  const codes = [...new Set(found.map((r) => r.code))].map((c) => `"${c}"`).join(", ");
  return new Error(
    `${found.length} Ramonda diagnostic(s) during this test:\n${lines.join("\n")}\n\n` +
      `Fix what it reports. A test that exists to show it can say so: allowDiagnostics(${codes}).`,
  );
}

/**
 * Opt out for the whole run. Import `@ramonda/testing-library/dont-fail-on-diagnostics` (or set
 * `RAMONDA_TL_ALLOW_DIAGNOSTICS`) before the library is loaded.
 */
let disabled = false;

export function disableFailOnDiagnostics(): void {
  disabled = true;
}

/**
 * Registered after each test the way `cleanup` is: through the runner's global hooks, so this package
 * picks no test runner. With no global `afterEach`, there is nothing to hook, and nothing happens.
 */
export function registerFailOnDiagnostics(): void {
  if (disabled) return;
  const proc = (globalThis as { process?: { env?: Record<string, string> } }).process;
  if (proc?.env?.RAMONDA_TL_ALLOW_DIAGNOSTICS) return;

  const g = globalThis as {
    beforeEach?: (fn: () => void) => void;
    afterEach?: (fn: () => void) => void;
  };
  if (typeof g.beforeEach !== "function" || typeof g.afterEach !== "function") return;

  // Installed only here, beside the hooks that empty it. Installed at import as well, it collected
  // every record of a run that had opted out, and nothing ever emptied it.
  install();
  g.beforeEach(startTest);
  g.afterEach(() => {
    // `cleanup` FIRST, here, whatever order the runner calls its hooks in. A hook that throws stops
    // the ones after it, so a check that ran before `cleanup` left the failed test's tree mounted —
    // and the next test met it: measured on the router's hydration tests, as "a second Router was
    // mounted". It also catches what a tree reports while it is being taken down. Not when the
    // project opted out of cleanup: keeping trees mounted is then what it asked for.
    if (autoCleanupOn()) cleanup();
    const failure = diagnosticsFailure();
    if (failure) throw failure;
  });
}
