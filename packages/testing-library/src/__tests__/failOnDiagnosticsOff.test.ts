import { afterEach, expect, test, vi } from "vitest";

/**
 * Off is off: nothing is collected. The sink was installed at import whatever was chosen, while what it
 * collected was cleared only by the hooks the opt-out does not register — so with the opt-out, or with
 * no global hooks, every record of the run was kept until the process ended. Found by the final review.
 */
afterEach(() => {
  delete process.env.RAMONDA_TL_ALLOW_DIAGNOSTICS;
  vi.resetModules();
});

test("with the check turned off, the library collects no diagnostics", async () => {
  process.env.RAMONDA_TL_ALLOW_DIAGNOSTICS = "1";
  vi.resetModules();
  await import("../index");
  // The same fresh module the index just loaded, so this reads what THAT one collected.
  const { diagnosticsFailure } = await import("../diagnostics");

  // What it collects, not whether the global moved: `@ramonda/devtools` installs a sink of its own
  // when it loads, and whether it loads during this import depends on the order of the run — measured,
  // the first version of this test asserted the global was untouched and failed in CI, not locally.
  globalThis.__RAMONDA_DIAGNOSTICS__?.({ code: "RMD997", scope: "ramonda/core", severity: "warn", time: 0 } as never);
  expect(diagnosticsFailure()).toBeUndefined();
});
