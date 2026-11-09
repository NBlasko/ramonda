// @vitest-environment node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/**
 * A project that opts out of the cleanup after each test and calls `cleanup()` itself still gets the
 * address back to where each test started. The start was taken only by the hook the opt-out skips, so a
 * manual cleanup sent every test after the first to the address at load. Found by review.
 */
test("a manual cleanup puts back the address the test started at", () => {
  const pkg = fileURLToPath(new URL("../..", import.meta.url));
  const run = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "vitest.opted-out.config.ts"], {
    cwd: pkg,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  expect(`${run.stdout}${run.stderr}`).toMatch(/Tests {2}4 passed \(4\)/);
}, 60_000);
