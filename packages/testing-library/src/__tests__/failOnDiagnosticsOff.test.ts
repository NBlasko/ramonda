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
  const before = globalThis.__RAMONDA_DIAGNOSTICS__;
  process.env.RAMONDA_TL_ALLOW_DIAGNOSTICS = "1";
  vi.resetModules();
  await import("../index");
  expect(globalThis.__RAMONDA_DIAGNOSTICS__).toBe(before);
});
