import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The claims the README makes that a type-checker cannot read.
 *
 * `scripts/check-examples.mjs` compiles every `ts` block on this page, which leaves exactly the
 * parts that are not TypeScript: a shell command, and a number. Both are the kind of thing that is
 * true when written and quietly false a month later — the size because the code grew, the command
 * because a script was renamed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const readme = readFileSync(join(root, "README.md"), "utf8");

describe("what the README says about this package", () => {
  test("names commands that exist", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      name: string;
      scripts: Record<string, string>;
    };

    /** A package manager's own verbs, which are not scripts and are not this package's to have. */
    const BUILTIN = new Set(["add", "install", "i", "remove", "why", "dlx", "exec", "create", "run", "up"]);

    // `pnpm bench` replaced a hard-coded path to the benchmark file, and it is written in prose
    // rather than in a fenced block — so both spellings are searched, because a renamed script
    // leaves the README telling a reader to run something that is not there either way.
    const scripts = [...readme.matchAll(/(?:^|`)(?:pnpm|npm) (?:run )?([a-z][a-z:-]*)(?:`|$)/gm)]
      .map(([, name]) => name)
      .filter((name) => !BUILTIN.has(name));

    expect(scripts).toContain("bench");
    for (const script of scripts) expect(Object.keys(manifest.scripts)).toContain(script);

    // And the install line names this package rather than a neighbour's.
    expect(readme).toContain(`npm install ${manifest.name}`);
  });

  test("states the size the build actually produces", () => {
    const bundle = join(root, "dist", "index.prod.js");
    if (!existsSync(bundle)) {
      throw new Error(`${bundle} is not built. The README quotes a size, so measuring it needs the build.`);
    }

    const claimed = readme.match(/^([\d.]+) KB gzipped/m);
    expect(claimed).not.toBeNull();

    // `gzip -9`, which is the method the figure was measured with — a different level answers a
    // different question, so the command is part of the claim.
    const gzipped = Number(
      execFileSync("sh", ["-c", `gzip -9c ${JSON.stringify(bundle)} | wc -c`], { encoding: "utf8" }).trim(),
    );
    const actual = gzipped / 1024;

    // A tenth of a kilobyte, which is the precision the README quotes to. Tighter would fail on
    // a gzip version that packs a byte differently; looser would let real growth through.
    expect(actual).toBeGreaterThan(0.5);
    expect(Math.abs(actual - Number(claimed?.[1]))).toBeLessThan(0.05);
  });
});
