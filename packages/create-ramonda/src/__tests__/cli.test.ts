import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

/**
 * The CLI as a script runs it: the built entry, spawned with no terminal.
 *
 * Found by an agent building an app from the docs alone. `--help` started the prompts; with stdin
 * closed it drew the first question and exited 0 having made nothing, so a script read success; and
 * no question could be answered any other way. Every case below spawns with stdin a pipe, which is
 * exactly that: not a TTY.
 */
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "..", "dist", "index.js");

let cwd: string;
beforeEach(() => {
  if (!existsSync(dist)) throw new Error("run `npm run build` first — these tests run the built CLI");
  cwd = mkdtempSync(join(tmpdir(), "create-ramonda-cli-"));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

function run(...args: string[]) {
  // No `npm_config_user_agent`: the CLI then speaks as npm, whatever ran this suite.
  const env = { ...process.env };
  delete env.npm_config_user_agent;
  const result = spawnSync(process.execPath, [dist, ...args], { cwd, env, encoding: "utf8", input: "" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const made = () => readdirSync(cwd);
const pkg = (dir: string) => JSON.parse(readFileSync(join(cwd, dir, "package.json"), "utf8"));

describe("asking for help", () => {
  test("--help names every flag, and makes nothing", () => {
    const { status, out } = run("--help");
    expect(status).toBe(0);
    for (const flag of ["--mode", "--add", "--git", "--no-git", "--install", "--no-install", "--overwrite", "--yes"])
      expect(out).toContain(flag);
    // Every add-on by the name `--add` takes.
    for (const addon of ["css", "router", "query", "form", "lens", "testing", "devtools", "biome"])
      expect(out).toContain(addon);
    expect(made()).toEqual([]);
  });

  test("-h is --help", () => {
    expect(run("-h").out).toContain("--mode");
  });

  test("--version prints the version, and makes nothing", () => {
    const { status, out } = run("--version");
    expect(status).toBe(0);
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(made()).toEqual([]);
  });
});

describe("with no terminal", () => {
  test("a question left unanswered is an error naming its flag, not a silent exit 0", () => {
    const { status, out } = run("app");
    expect(status).toBe(1);
    expect(out).toContain("--mode");
    expect(out).toContain("--yes");
    expect(made()).toEqual([]);
  });

  test("--yes takes every default: SPA, CSS and devtools", () => {
    const { status, out } = run("app", "--yes", "--no-install", "--no-git");
    expect(status, out).toBe(0);
    const json = pkg("app");
    expect(Object.keys(json.dependencies)).toContain("@ramonda/css");
    expect(Object.keys(json.devDependencies)).toContain("@ramonda/devtools");
    expect(existsSync(join(cwd, "app", "src", "main.tsx"))).toBe(true);
    expect(existsSync(join(cwd, "app", ".git"))).toBe(false);
  });

  test("every question answered by a flag needs no --yes", () => {
    const { status, out } = run("app", "--mode", "ssr", "--add", "query,testing", "--no-git", "--no-install");
    expect(status, out).toBe(0);
    const json = pkg("app");
    expect(Object.keys(json.dependencies)).toEqual(expect.arrayContaining(["@ramonda/query", "@ramonda/router"]));
    expect(Object.keys(json.dependencies)).not.toContain("@ramonda/css");
    expect(existsSync(join(cwd, "app", "src", "entry-server.tsx"))).toBe(true);
  });

  test("--add none chooses nothing", () => {
    const { status, out } = run("app", "--yes", "--add", "none", "--no-install", "--no-git");
    expect(status, out).toBe(0);
    expect(Object.keys(pkg("app").dependencies)).toEqual(["@ramonda/core"]);
  });

  test("with no folder named, --yes uses the default one", () => {
    const { status, out } = run("--yes", "--no-install", "--no-git");
    expect(status, out).toBe(0);
    expect(made()).toEqual(["ramonda-app"]);
  });
});

describe("a wrong flag", () => {
  test("an unknown flag is refused before anything is written", () => {
    const { status, out } = run("app", "--yes", "--sssr");
    expect(status).toBe(1);
    expect(out).toContain("--sssr");
    expect(out).toContain("--help");
    expect(made()).toEqual([]);
  });

  test("an unknown add-on names the ones there are", () => {
    const { status, out } = run("app", "--yes", "--add", "css,quey");
    expect(status).toBe(1);
    expect(out).toContain("quey");
    expect(out).toContain("query");
    expect(made()).toEqual([]);
  });

  test("an unknown mode names the two there are", () => {
    const { status, out } = run("app", "--mode", "static");
    expect(status).toBe(1);
    expect(out).toContain("spa");
    expect(out).toContain("ssr");
  });
});

describe("a folder that is not empty", () => {
  beforeEach(() => {
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "keep.txt"), "mine");
  });

  test("--yes does not mean overwrite: it is refused, and left alone", () => {
    const { status, out } = run("app", "--yes", "--no-install", "--no-git");
    expect(status).toBe(1);
    expect(out).toContain("--overwrite");
    expect(readdirSync(join(cwd, "app"))).toEqual(["keep.txt"]);
  });

  test("--overwrite writes into it", () => {
    const { status, out } = run("app", "--yes", "--overwrite", "--no-install", "--no-git");
    expect(status, out).toBe(0);
    expect(existsSync(join(cwd, "app", "package.json"))).toBe(true);
  });
});
