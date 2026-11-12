import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ruleCatalogue } from "@ramonda/check";

/**
 * The docs `@ramonda/check` carries, for the version it is: packed by the script a release runs, and
 * read back through the commands a reader runs. Every code the diagnostics page explains and every
 * rule the checker has must answer — a code printed by this version with no page behind it is a
 * dead end with no network to fall back on.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");
let packed: string;

beforeAll(() => {
  packed = mkdtempSync(join(tmpdir(), "docs-packed-"));
  const pack = spawnSync(process.execPath, [join(repo, "scripts", "pack-docs-text.mjs"), packed], { encoding: "utf8" });
  expect(pack.status, pack.stderr).toBe(0);
});
afterAll(() => rmSync(packed, { recursive: true, force: true }));

const check = (...args: string[]) =>
  spawnSync(process.execPath, [join(repo, "packages", "check", "bin.mjs"), ...args], {
    encoding: "utf8",
    env: { ...process.env, RAMONDA_CHECK_DOCS: packed },
  });

/**
 * Every page is checked as a FILE in what was packed, and the commands are run a few times — once for a
 * code, once for a rule, once for a page. Running the command once per code and per rule spawned some
 * hundred and seventy processes: two minutes, and past the time limit on a slower CI runner.
 */
describe("the docs @ramonda/check carries", () => {
  test("every code the diagnostics page explains has its page", () => {
    const page = readFileSync(join(here, "..", "..", "content", "reference", "diagnostics.md"), "utf8");
    const codes = [...page.matchAll(/^## (RM[DQFL]\d{3}) — /gm)].map((match) => match[1]);
    expect(codes.length).toBeGreaterThan(50);
    for (const code of codes) {
      const file = join(packed, "reference", "diagnostics", `${code.toLowerCase()}.md`);
      expect(existsSync(file), code).toBe(true);
      expect(readFileSync(file, "utf8").startsWith(`# ${code} — `), code).toBe(true);
    }
  });

  test("every rule the checker has has its page", () => {
    for (const rule of ruleCatalogue()) {
      const file = join(packed, "rules", `${rule.id}.md`);
      expect(existsSync(file), rule.id).toBe(true);
      expect(readFileSync(file, "utf8"), rule.id).toContain(rule.id);
    }
  });

  test("the commands read them: a code, a rule, the index, and a page by the address the index gives it", () => {
    const code = check("explain", "RMD020");
    expect(code.status).toBe(0);
    expect(code.stdout.startsWith("# RMD020 — ")).toBe(true);

    const rule = check("explain", "unknown-hook-option");
    expect(rule.status).toBe(0);
    expect(rule.stdout).toContain("unknown-hook-option");

    const index = check("docs");
    expect(index.stdout).toContain("# Ramonda");
    const address = /\((https:\/\/ramonda\.dev\/forms\/fields\.md)\)/.exec(index.stdout)?.[1];
    expect(address).toBeDefined();
    expect(check("docs", address as string).stdout.startsWith("# ")).toBe(true);
  });
});
