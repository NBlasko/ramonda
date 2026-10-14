import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `--help` and `--version` on both commands, as `create-ramonda` and `ramonda-css` have them.
 *
 * Found by an agent building an app from the docs alone: `ramonda-check --help` ignored the flag and
 * ran the check, and `ramonda-check-bundle --help` took `--help` for a path it could not read. Both
 * run through the shipped launchers.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;

/**
 * Each run in a scratch folder of its own, never the package's: `--graph -x`, run before its guard
 * existed, wrote a graph to a file named `-x` in the package — and that file was committed.
 */
const run = (bin: string, ...args: string[]) => runIn(mkdtempSync(join(tmpdir(), "check-cli-")), bin, ...args);
function runIn(cwd: string, bin: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [join(root, bin), ...args], { cwd, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}`, cwd };
}

describe("ramonda-check", () => {
  it("--help names every option and the exit codes, and checks nothing", () => {
    const { status, out } = run("bin.mjs", "--help");
    expect(status).toBe(0);
    expect(out).toContain("Usage: ramonda-check");
    // Each at the start of its own line of the options list: `--graph` is inside `--graph-html`, and
    // `--fix` and `--split` are named in other lines' prose, so a plain search found them anyway.
    for (const flag of [
      "--graph",
      "--graph-html",
      "--diff",
      "--split",
      "--fix",
      "--dry-run",
      "--certify",
      "--help",
      "--version",
    ])
      expect(out, flag).toMatch(new RegExp(`^  ${flag}(?= |$)`, "m"));
    expect(out).toContain("Exit codes");
    expect(out).not.toContain("components,");
  });

  it("-h is --help, and --version prints the version", () => {
    expect(run("bin.mjs", "-h").out).toContain("Usage: ramonda-check");
    const { status, out } = run("bin.mjs", "--version");
    expect(status).toBe(0);
    expect(out.trim()).toBe(version);
  });

  it("a short option it does not have is refused, not read as a tsconfig", () => {
    const { status, out } = run("bin.mjs", "-x");
    expect(status).toBe(2);
    expect(out).toContain("unknown option -x");
  });

  it("an option written with = is named for what it is", () => {
    const { status, out } = run("bin.mjs", "--graph=g.json");
    expect(status).toBe(2);
    expect(out).toContain("--graph g.json");
  });

  it("a second tsconfig is refused, not quietly ignored", () => {
    const { status, out } = run("bin.mjs", "tsconfig.json", "other.json");
    expect(status).toBe(2);
    expect(out).toContain("other.json");
  });

  it("--dry-run without --fix is refused, not quietly ignored", () => {
    const { status, out } = run("bin.mjs", "--dry-run");
    expect(status).toBe(2);
    expect(out).toContain("--fix");
  });

  it("an option after one that takes a file is not taken for the file", () => {
    const { status, out } = run("bin.mjs", "--graph", "-x");
    expect(status).toBe(2);
    expect(out).toContain("--graph wants a file");
  });

  it("never writes the graph over the tsconfig it reads", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-cli-"));
    writeFileSync(join(dir, "tsconfig.json"), "{}\n");
    const { status, out } = runIn(dir, "bin.mjs", "tsconfig.json", "--graph", "tsconfig.json");
    expect(status).toBe(2);
    expect(out).toContain("tsconfig.json");
    expect(readFileSync(join(dir, "tsconfig.json"), "utf8")).toBe("{}\n");
  });

  it("a word after a flag's value is a path of its own, not a second copy of the value", () => {
    // With a project there, so the only thing that can stop it is the second path.
    const dir = mkdtempSync(join(tmpdir(), "check-cli-"));
    writeFileSync(join(dir, "tsconfig.json"), "{}\n");
    const { status, out } = runIn(dir, "bin.mjs", "--graph", "out.json", "out.json");
    expect(status, out).toBe(2);
    expect(existsSync(join(dir, "out.json"))).toBe(false);
  });

  it("an option it does not have is refused, with the one meant", () => {
    const { status, out } = run("bin.mjs", "--grahp", "g.json");
    expect(status).toBe(2);
    expect(out).toContain("--grahp");
    expect(out).toContain("Did you mean --graph?");
  });
});

describe("ramonda-check-bundle", () => {
  it("--help explains it and exits 0 without reading a path called --help", () => {
    const { status, out } = run("check-bundle.mjs", "--help");
    expect(status).toBe(0);
    expect(out).toContain("Usage: ramonda-check-bundle");
    expect(out).toContain("Exit codes");
    expect(out).not.toContain("cannot read");
  });

  it("--version prints the version", () => {
    const { status, out } = run("check-bundle.mjs", "--version");
    expect(status).toBe(0);
    expect(out.trim()).toBe(version);
  });

  it("a path that starts with a dash is checked as a path", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-bundle-dash-"));
    mkdirSync(join(dir, "-out"));
    writeFileSync(join(dir, "-out", "a.js"), "export const a = 1;\n");
    const result = spawnSync(process.execPath, [join(root, "check-bundle.mjs"), "./-out"], {
      cwd: dir,
      encoding: "utf8",
    });
    rmSync(dir, { recursive: true, force: true });
    expect(`${result.stdout}${result.stderr}`).toContain("1 emitted file(s) parse");
    expect(result.status).toBe(0);
  });

  it("an option it does not have is refused, not read as a path", () => {
    const { status, out } = run("check-bundle.mjs", "--verbose", "dist");
    expect(status).toBe(2);
    expect(out).toContain("--verbose");
    expect(out).not.toContain("cannot read");
  });
});
