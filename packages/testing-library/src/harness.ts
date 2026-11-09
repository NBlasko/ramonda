import { autoCleanupOn, cleanupHooked } from "./cleanup";
import { diagnosticsHooked, failOnDiagnosticsOn } from "./diagnostics";

/**
 * Refuses to render when the work this package does after each test cannot happen.
 *
 * Both halves hang off the runner's GLOBAL `afterEach` — this package does not pick a runner, so it
 * cannot import one. In a vitest without `globals: true` there is none, and both were skipped in
 * silence: every test's tree stayed mounted into the next, and a development diagnostic passed.
 * Found by an agent building an app from the docs alone, which learned it only when a second Router
 * threw three tests later, far from the cause.
 *
 * A throw rather than a warning, because a warning is not seen: the runner hides the console of a
 * test that passes, which is how the diagnostics went unseen in the first place. Thrown from
 * `render`, which is where the missing cleanup starts to matter, and not at import — a file that
 * imports a query helper and renders nothing has nothing to clean up.
 *
 * Each half is a choice the project can make out loud, and then it is not asked for.
 */
export function requireHarness(): void {
  const cleanup = autoCleanupOn() && !cleanupHooked();
  const diagnostics = failOnDiagnosticsOn() && !diagnosticsHooked();
  if (!cleanup && !diagnostics) return;

  const cannot = [
    cleanup ? "unmount what a test rendered" : undefined,
    diagnostics ? "fail a test that caused a development diagnostic" : undefined,
  ].filter((part) => part !== undefined);
  const optOuts = [
    cleanup
      ? '  import "@ramonda/testing-library/dont-cleanup-after-each"; // and call cleanup() after each test'
      : undefined,
    diagnostics ? '  import "@ramonda/testing-library/dont-fail-on-diagnostics";' : undefined,
  ].filter((part) => part !== undefined);

  throw new Error(
    `@ramonda/testing-library found no global \`afterEach\`, so after each test it cannot ${cannot.join(", or ")}. ` +
      "Without that, a test's tree stays mounted into the next one, and a diagnostic passes unseen.\n\n" +
      "Turn on the test runner's globals — in vitest, `test: { globals: true }` in its config. Or say you do " +
      "this yourself, before anything else in the setup file:\n\n" +
      `${optOuts.join("\n")}\n\n` +
      "https://ramonda.dev/testing",
  );
}
