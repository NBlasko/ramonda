import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

const run = (bin: string, ...args: string[]) => {
  const result = spawnSync(process.execPath, [join(root, bin), ...args], { cwd: root, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
};

describe("ramonda-check", () => {
  it("--help names every option and the exit codes, and checks nothing", () => {
    const { status, out } = run("bin.mjs", "--help");
    expect(status).toBe(0);
    expect(out).toContain("Usage: ramonda-check");
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
      expect(out, flag).toContain(flag);
    expect(out).toContain("Exit codes");
    expect(out).not.toContain("components,");
  });

  it("-h is --help, and --version prints the version", () => {
    expect(run("bin.mjs", "-h").out).toContain("Usage: ramonda-check");
    const { status, out } = run("bin.mjs", "--version");
    expect(status).toBe(0);
    expect(out.trim()).toBe(version);
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

  it("an option it does not have is refused, not read as a path", () => {
    const { status, out } = run("check-bundle.mjs", "--verbose", "dist");
    expect(status).toBe(2);
    expect(out).toContain("--verbose");
    expect(out).not.toContain("cannot read");
  });
});
