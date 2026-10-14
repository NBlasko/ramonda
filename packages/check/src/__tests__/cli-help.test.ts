import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

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
/** Whether this machine's temp disk folds case, as macOS's does by default. */
function caseInsensitive(): boolean {
  const dir = folder();
  writeFileSync(join(dir, "a"), "");
  return existsSync(join(dir, "A"));
}
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
/** A scratch folder, removed after the file's tests. */
function folder(withTsconfig = false): string {
  const dir = mkdtempSync(join(tmpdir(), "check-cli-"));
  scratch.push(dir);
  if (withTsconfig) writeFileSync(join(dir, "tsconfig.json"), "{}\n");
  return dir;
}
const run = (bin: string, ...args: string[]) => runIn(folder(), bin, ...args);
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
    const dir = folder(true);
    const { status, out } = runIn(dir, "bin.mjs", "tsconfig.json", "--graph", "tsconfig.json");
    expect(status).toBe(2);
    expect(out).toContain("tsconfig.json");
    expect(readFileSync(join(dir, "tsconfig.json"), "utf8")).toBe("{}\n");
  });

  it("a word after a flag's value is a path of its own, not a second copy of the value", () => {
    // With a project there, so the only thing that can stop it is the second path.
    const dir = folder(true);
    const { status, out } = runIn(dir, "bin.mjs", "--graph", "out.json", "out.json");
    expect(status, out).toBe(2);
    expect(existsSync(join(dir, "out.json"))).toBe(false);
  });

  // The tsconfig, by what it IS rather than how it is spelled: a different case on a case-insensitive
  // disk, and a link to it, both wrote the graph over it.
  it.each([
    [
      "a link to it",
      (dir: string) => {
        symlinkSync(join(dir, "tsconfig.json"), join(dir, "link.json"));
        return "link.json";
      },
    ],
    ["another case of its name", () => (caseInsensitive() ? "TSCONFIG.json" : "tsconfig.json")],
  ])("never writes the graph over the tsconfig through %s", (_what, name) => {
    const dir = folder(true);
    const target = name(dir);
    const { status } = runIn(dir, "bin.mjs", "--graph", target);
    expect(status).toBe(2);
    expect(readFileSync(join(dir, "tsconfig.json"), "utf8")).toBe("{}\n");
  });

  it("never writes the graph over the graph it is asked to compare against", () => {
    const dir = folder(true);
    writeFileSync(join(dir, "g.json"), "BASELINE");
    const { status } = runIn(dir, "bin.mjs", "--graph", "g.json", "--diff", "g.json");
    expect(status).toBe(2);
    expect(readFileSync(join(dir, "g.json"), "utf8")).toBe("BASELINE");
  });

  it("writes the graph and its page to two files, not one over the other", () => {
    expect(runIn(folder(true), "bin.mjs", "--graph", "g.json", "--graph-html", "g.json").status).toBe(2);
  });

  it("an option given twice is refused, not read once", () => {
    const { status, out } = runIn(folder(true), "bin.mjs", "--graph", "a.json", "--graph", "b.json");
    expect(status).toBe(2);
    expect(out).toContain("--graph");
  });

  it("a folder is read as the tsconfig inside it", () => {
    const dir = folder(true);
    const { status, out } = runIn(dir, "bin.mjs", ".");
    expect(out).not.toContain("    at ");
    expect(status).not.toBe(1);
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
