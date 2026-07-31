import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { ScaffoldOptions } from "../index";

/**
 * The BUILT entry, not the source, and that is the point: the version ranges are injected by
 * `tsup` at build time (see tsup.config.ts), so the source alone cannot tell you what a user
 * would get. Testing dist checks the artifact that ships, including that the injection
 * happened.
 */
let scaffold: (options: ScaffoldOptions) => void;
let nodeIsOldEnough: (version: string) => boolean;
let MIN_NODE: number;

beforeAll(async () => {
  const dist = join(here, "..", "..", "dist", "index.js");
  if (!existsSync(dist)) throw new Error("run `npm run build` first — these tests check the built CLI");
  const built = (await import(dist)) as {
    scaffold: typeof scaffold;
    nodeIsOldEnough: typeof nodeIsOldEnough;
    MIN_NODE: number;
  };
  scaffold = built.scaffold;
  nodeIsOldEnough = built.nodeIsOldEnough;
  MIN_NODE = built.MIN_NODE;
});

/**
 * What a scaffolded project must contain for its FIRST `install`, `dev` and `test` to work.
 *
 * Every case here stands for a defect that shipped, because the scaffolder had no tests and
 * nothing else could see these: CI installs from the workspace, and the failures only appear
 * against the registry, on pnpm 10+, in a fresh project. They are cheap to check at this
 * level — no network, no install — which is exactly why they belong here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const workspace = join(here, "..", "..", "..", "..");
const dirs: string[] = [];

function make(mode: "spa" | "ssr", addons: ScaffoldOptions["addons"]) {
  const dir = mkdtempSync(join(tmpdir(), `ramonda-scaffold-${mode}-`));
  dirs.push(dir);
  scaffold({ targetDir: dir, name: `${mode}-app`, mode, addons });
  return {
    dir,
    pkg: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      pnpm?: unknown;
    },
    read: (file: string) => readFileSync(join(dir, file), "utf8"),
  };
}

/** The version a package sits at in this workspace — what a range has to accept. */
function workspaceVersion(folder: string): string {
  return (JSON.parse(readFileSync(join(workspace, "packages", folder, "package.json"), "utf8")) as { version: string })
    .version;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("first-party versions", () => {
  test("every @ramonda range matches that package's workspace version", () => {
    const { pkg } = make("ssr", ["router", "query", "lens", "devtools", "testing", "biome"]);
    const all = { ...pkg.dependencies, ...pkg.devDependencies };

    /**
     * The defect this stands for: one hand-written constant for all of them (`~0.0.1`), so a
     * fresh install failed with `No matching version found for @ramonda/query@~0.0.1`. They do
     * not share a version line — core and query are on 0.1.x, router/lens/testing-library each
     * on their own 0.0.x — so a single range cannot be right for all.
     */
    for (const [name, folder] of [
      ["@ramonda/core", "core"],
      ["@ramonda/router", "router"],
      ["@ramonda/query", "query"],
      ["@ramonda/lens", "lens"],
      ["@ramonda/devtools", "devtools"],
      ["@ramonda/testing-library", "testing-library"],
    ] as const) {
      expect(all[name], `${name} is not in the generated package.json`).toBeDefined();
      expect(all[name], `${name} must track the workspace`).toBe(`~${workspaceVersion(folder)}`);
    }
  });

  test("a tilde, not a caret, because a caret on 0.0.z pins that exact patch", () => {
    const { pkg } = make("spa", ["router"]);
    expect(pkg.dependencies["@ramonda/router"]!.startsWith("~")).toBe(true);
  });
});

describe("third-party versions", () => {
  test("they are the ones this workspace is tested against", () => {
    const { pkg } = make("ssr", ["testing", "biome"]);
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const core = JSON.parse(readFileSync(join(workspace, "packages", "core", "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };

    // vitest drifted to a whole major once: the template said ^3.2.4 while the framework was
    // on ^4.1.10, so a generated project tested against something core does not use.
    expect(all.vitest).toBe(core.devDependencies.vitest);
    expect(all.jsdom).toBe(`^${core.devDependencies.jsdom!.replace(/^[\^~]/, "")}`);
  });

  test("vitest brings vite, which is its peer dependency", () => {
    /**
     * Without it vitest has no transform. Measured on a scaffolded SSR project: the .tsx
     * reached the runtime unchanged and the suite died with `SyntaxError: Invalid or unexpected
     * token`. The SPA template had vite already, which is why only SSR was broken.
     */
    for (const mode of ["ssr", "spa"] as const) {
      const { pkg } = make(mode, ["testing"]);
      expect(pkg.devDependencies.vite, `${mode} needs vite for vitest`).toBeDefined();
    }
  });

  test("no vite when there is nothing to test and nothing to serve", () => {
    const { pkg } = make("ssr", []);
    expect(pkg.devDependencies.vite).toBeUndefined();
  });
});

describe("pnpm can run the build scripts it needs", () => {
  test("a pnpm-workspace.yaml allows esbuild, in both spellings", () => {
    for (const mode of ["ssr", "spa"] as const) {
      const { read } = make(mode, []);
      const yaml = read("pnpm-workspace.yaml");

      /**
       * pnpm 10 and 11 refuse to run a dependency's build scripts until the project says which
       * are allowed, and exit NON-ZERO when any were skipped. esbuild's script places its
       * binary, so `pnpm dev` failed on every fresh project. The key was renamed between the
       * two versions, hence both.
       */
      expect(yaml).toContain("allowBuilds:");
      expect(yaml).toMatch(/esbuild: true/);
      expect(yaml).toContain("onlyBuiltDependencies:");
    }
  });

  test("the pnpm field in package.json is NOT used — pnpm 11 ignores it", () => {
    const { pkg } = make("spa", []);
    expect(pkg.pnpm).toBeUndefined();
  });
});

describe("the devtools panel", () => {
  test("is imported from the entry, behind the right guard per template", () => {
    /**
     * Core loads the panel through a dynamic import whose specifier is a variable marked
     * `@vite-ignore`, so a bundler leaves it, the browser cannot fetch it, and core's `.catch()`
     * swallows that by design. The add-on installed a package nothing imported, and no badge
     * ever appeared.
     */
    const ssr = make("ssr", ["devtools"]);
    expect(ssr.read("src/entry-client.tsx")).toContain('if (__DEV__) void import("@ramonda/devtools")');

    const spa = make("spa", ["devtools"]);
    expect(spa.read("src/main.tsx")).toContain('if (import.meta.env.DEV) void import("@ramonda/devtools")');
  });

  test("is absent when the add-on was not chosen", () => {
    const { read, pkg } = make("spa", ["router"]);
    expect(read("src/main.tsx")).not.toContain("@ramonda/devtools");
    expect(pkg.devDependencies["@ramonda/devtools"]).toBeUndefined();
  });
});

describe("development is development", () => {
  test("the SSR template builds dev with development conditions and prod with production", () => {
    const { pkg } = make("ssr", []);
    const scripts = (pkg as unknown as { scripts: Record<string, string> }).scripts;

    /**
     * `dev` used to build with `--conditions=production`, so a scaffolded SSR app ran the
     * production core: no diagnostics, no strict render, no devtools.
     */
    expect(scripts["dev:client"]).toContain("--conditions=development");
    expect(scripts["dev:client"]).toContain("--define:__DEV__=true");
    expect(scripts["build:client"]).toContain("--conditions=production");
    expect(scripts["build:client"]).toContain("--define:__DEV__=false");
    expect(scripts.dev).toContain("dev:client");
  });
});

describe("the generated project declares what its own code needs", () => {
  test("the SSR template declares __DEV__, which guards the devtools import", () => {
    const { read } = make("ssr", ["devtools"]);

    // The entry says `if (__DEV__)`, so the project has to declare it or its own `tsc` fails.
    // esbuild replaces it per build: true for `dev`, false for `build`.
    expect(read("global.d.ts")).toContain("__DEV__");
  });

  test("the SPA template does not, because vite provides import.meta.env.DEV", () => {
    const { read } = make("spa", ["devtools"]);
    expect(read("global.d.ts")).not.toContain("__DEV__");
    expect(read("src/main.tsx")).toContain("import.meta.env.DEV");
  });
});

/**
 * Type-checking a scaffolded project is NOT tested here, and that is deliberate: it needs a
 * real install to resolve `@ramonda/*` and `vitest`, and a symlink to this workspace's
 * `node_modules` does not provide them (pnpm's isolated layout keeps them in each package's
 * own directory). That check belongs to the end-to-end pass described in
 * `.claude/skills/update-dependencies` — scaffold, install, dev, test, against the registry.
 */

/**
 * The Node floor, which is a REFUSAL rather than a warning.
 *
 * `engines` in package.json is advisory — npm prints a line and `npm create` proceeds — so the number
 * there cannot be the mechanism. The mechanism is a check at the top of `main`, before anything is
 * written, because a project scaffolded on a Node whose toolchain cannot build it is worse than no
 * project: the failure arrives later, somewhere else, and looks like Ramonda's fault.
 *
 * Tested through the exported predicate rather than by spawning the CLI per version. That the CLI
 * actually refuses was verified by running the built entry with `process.versions.node` patched to
 * 22.9.0: it printed the message, exited 1, and wrote no files.
 */
describe("the Node floor", () => {
  test("accepts the pinned version and rejects anything older", () => {
    expect(MIN_NODE).toBe(24);
    expect(nodeIsOldEnough("24.0.0")).toBe(true);
    expect(nodeIsOldEnough("24.15.0")).toBe(true);
    expect(nodeIsOldEnough("28.1.0")).toBe(true);

    expect(nodeIsOldEnough("23.11.0")).toBe(false);
    expect(nodeIsOldEnough("22.9.0")).toBe(false);
    expect(nodeIsOldEnough("18.20.4")).toBe(false);
  });

  test("agrees with the engines field, so the advisory and the refusal cannot disagree", () => {
    const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8")) as {
      engines?: { node?: string };
    };
    expect(pkg.engines?.node).toBe(`>=${MIN_NODE}`);
  });
});
