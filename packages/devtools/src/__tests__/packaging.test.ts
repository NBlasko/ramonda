// @vitest-environment node
// Bundles a file and reads the output. No DOM, and `node:` builtins do not resolve under the
// config's jsdom default once NODE_ENV is set.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

/**
 * What a bundler does with `import "@ramonda/devtools"`.
 *
 * ## The fault this exists for
 *
 * This package declared `"sideEffects": false`, and the entry both registers
 * `<ramonda-devtools>` and subscribes the diagnostics bridge — so the claim was false, and
 * a bundler is entitled to act on it. Measured: bundling a bare import of the built entry
 * with esbuild produced **0 bytes**. Not a missing registration, not a missing bridge — the
 * whole package, discarded, because the package said there was nothing to keep.
 *
 * Nothing caught it because nothing bundles this package that way: Vite's dev server does
 * not tree-shake, and a production build usually leaves the panel out on purpose. It would
 * have surfaced as "the devtools do not appear" in exactly one configuration, with nothing
 * to blame it on.
 *
 * ## Why it runs a real bundler
 *
 * The question is not what the field says, which a test could only restate. It is what a
 * bundler DOES with what the field says — so the oracle is a bundler, the same way
 * `ramonda-check-bundle` asks an engine whether its output parses.
 *
 * The control matters as much as the check: `@ramonda/lens` genuinely has no side effects
 * and says so, and its bare import must be dropped to nothing. Without that, a harness that
 * had stopped tree-shaking at all — a flag renamed, a default changed — would report this
 * package as correct while proving nothing.
 */

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const devtools = join(here, "..", "..", "dist", "index.js");
const lens = join(here, "..", "..", "..", "lens", "dist", "index.js");

const work = mkdtempSync(join(tmpdir(), "ramonda-sideeffects-"));

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

/**
 * Bundles nothing but a bare import of one built entry, and answers with what survived.
 *
 * `sideEffects` is read from the package.json nearest the imported FILE, so importing by
 * absolute path is the same question a consumer's `import "@ramonda/devtools"` asks, without
 * needing the package to be resolvable from a scratch directory.
 */
async function bundle(entry: string, name: string): Promise<string> {
  // The subject is the EMITTED package, so this needs a build. Said here rather than left to
  // esbuild's ENOENT, which names a path and not the reason.
  if (!existsSync(entry)) {
    throw new Error(
      `${entry} is not built. This asks what a bundler does with the emitted package, so run the build first.`,
    );
  }

  const source = join(work, `${name}.js`);
  const out = join(work, `${name}.out.js`);
  writeFileSync(source, `import ${JSON.stringify(entry)};\n`);

  await run("npx", ["esbuild", "--bundle", "--format=esm", "--minify", `--outfile=${out}`, source]);
  return readFileSync(out, "utf8");
}

describe("what a bundler keeps", () => {
  it("keeps the panel registration and the diagnostics bridge", async () => {
    const output = await bundle(devtools, "devtools");

    // The two things importing this package is FOR, and the two things a
    // `"sideEffects": false` let a bundler throw away.
    expect(output).toContain("customElements.define");
    expect(output).toContain("__RAMONDA_DIAGNOSTICS__");
  });

  it("drops a package that really has no side effects, which is what makes the above mean something", async () => {
    // `@ramonda/lens` declares `"sideEffects": false` and earns it: every export is a
    // function, and nothing runs on import. A bundler should be able to erase this
    // entirely — and if it cannot, the check above passed for the wrong reason.
    const output = await bundle(lens, "lens");

    expect(output.trim()).toBe("");
  });
});
