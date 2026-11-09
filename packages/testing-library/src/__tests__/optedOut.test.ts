// @vitest-environment node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/**
 * A project that opts out of the cleanup after each test and calls `cleanup()` itself — at the end of a
 * test, or at the start of the next — still gets back the address a test's `render(…, { url })` replaced.
 * Found by review, twice, while the start of a test was guessed rather than recorded by `render`.
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
