// @vitest-environment node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/**
 * Without the runner's globals there is no `afterEach` to hook, and the cleanup and the diagnostics
 * check after each test were both skipped without a word. Found by an agent building an app from the
 * docs alone: the first it heard was a second Router throwing, three tests later.
 *
 * `fixtures` cannot show it: they run with globals on. So `no-globals/` runs in a vitest of its own
 * with them off — one file refused, one that opted out of both, one that opted out of one.
 */
test("a runner with no globals is refused at render, unless the project opted out", () => {
  const pkg = fileURLToPath(new URL("../..", import.meta.url));
  const run = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "vitest.no-globals.config.ts"], {
    cwd: pkg,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  const out = `${run.stdout}${run.stderr}`;
  expect(out).toMatch(/Tests {2}3 passed \(3\)/);
  expect(run.status).toBe(0);
}, 60_000);
