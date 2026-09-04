import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "../../dist/cli.js");
const fixture = (name: string) => join(here, "fixtures", name, "tsconfig.json");

function run(...args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], (error, stdout, stderr) => {
      const code =
        error && typeof (error as { code?: unknown }).code === "number"
          ? (error as { code: number }).code
          : error
            ? 1
            : 0;
      resolve({ code, output: `${stdout}${stderr}` });
    });
  });
}

/**
 * `--fix --dry-run` is a CHECK, and the exit code is the whole of its answer.
 *
 * It is what makes `--fix` usable in a gate: a fault the checker knows the answer to, left in the
 * tree, is one nobody has an excuse for. Most of them are warnings and a normal run exits 0 on
 * those — which is right, because a warning is a judgement somebody may reasonably defer. A warning
 * with a MECHANICAL answer is not that.
 *
 * These run the built CLI as a process, because an exit code is not something the analyzer returns
 * and a gate step that silently stopped failing would be worse than no step at all. `dist/` has to
 * exist, and `turbo.json` has `test` depend on `build` — so in a gate the CLI is there and these
 * run. A bare `vitest` in this package with no build is the case the skip is for, and there a check
 * that could not be performed is honestly reported as not performed.
 *
 * **But not in CI, and that is deliberate.** These three are now the only place the built CLI is put
 * through `--fix`: the step that did it over `apps/docs` left `pnpm check` on 2026-09-04, measured
 * redundant with the run before it and costing 25-30 seconds. So a missing CLI under `CI` is a
 * failure rather than a skip — otherwise a change to `turbo.json`, or a build that emits another
 * name, would take the fixer's whole coverage away while every job stayed green.
 *
 * Measured by deleting `dist/cli.js`: present, three pass; missing with no `CI`, three skip; missing
 * under `CI`, **two** fail and name `Cannot find module …/dist/cli.js`. Two rather than three,
 * because the idempotence test compares one run's output with the next and two identical failures
 * are identical — so it is the two that read the output which carry this.
 */
describe("the gate's fixable-fault step", () => {
  test.skipIf(!existsSync(CLI) && !process.env.CI)("fails when a fault has an answer nobody applied", async () => {
    const { code, output } = await run(fixture("mechanical-fixes"), "--fix", "--dry-run");

    expect(code).toBe(1);
    expect(output).toContain("would apply");
    expect(output).toContain("`class` → `className`");
    // And it says what to do about it, rather than only that it failed.
    expect(output).toContain("run `--fix` to apply them");
  });

  test.skipIf(!existsSync(CLI) && !process.env.CI)("passes when every remaining fault needs a person", async () => {
    // `foreign-child` reports plenty, and not one of its faults has a single mechanical answer.
    const { code, output } = await run(fixture("foreign-child"), "--fix", "--dry-run");

    expect(code).toBe(0);
    expect(output).toContain("nothing to fix");
  });

  /**
   * A dry run writes nothing, which is the one thing that would be unforgivable to get wrong.
   *
   * Asserted through the CHECK path rather than only through `applyFixes`, because the flag that
   * decides it is read in the CLI and a wiring mistake there would not touch the unit test.
   */
  test.skipIf(!existsSync(CLI) && !process.env.CI)(
    "and the tree is untouched, so running it twice says the same thing",
    async () => {
      const first = await run(fixture("mechanical-fixes"), "--fix", "--dry-run");
      const second = await run(fixture("mechanical-fixes"), "--fix", "--dry-run");

      expect(second.code).toBe(1);
      expect(second.output).toBe(first.output);
    },
  );
});
