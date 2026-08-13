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
    const { pkg } = make("ssr", ["router", "query", "form", "lens", "devtools", "testing", "biome"]);
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
      ["@ramonda/form", "form"],
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

/**
 * A package's devtools tab arrives with the package, not with the scaffolder.
 *
 * `@ramonda/query` and `@ramonda/form` each describe their own tab and register it from the
 * lifecycle of something the app mounts — a provider, a form. So there is nothing to add here when
 * an add-on is picked, and nothing to remove when it is not: the panel builds a tab for whatever
 * registered one.
 *
 * This test is the guard on that arrangement. If a future package needs the scaffolder to wire its
 * panel up, the wiring belongs with that package instead.
 */
describe("devtools tabs come from the packages", () => {
  test("each package with a tab gets its own import, under the dev guard", () => {
    const { dir } = make("spa", ["query", "form", "devtools"]);
    const entry = readFileSync(join(dir, "src", "main.tsx"), "utf8");

    expect(entry).toContain('void import("@ramonda/devtools")');
    expect(entry).toContain('void import("@ramonda/query/devtools")');
    expect(entry).toContain('void import("@ramonda/form/devtools")');

    /**
     * Imports rather than registrations, and that is the whole arrangement: a package ANNOUNCES
     * what it holds with an event and never imports the module that describes it, so the
     * description is only in the bundle of an app that asked for it.
     */
    expect(entry).not.toContain("registerDevtools");
    expect(entry).not.toContain("panelRegistry");
  });

  test("a package that was not picked contributes no import", () => {
    const { dir } = make("spa", ["query", "devtools"]);
    const entry = readFileSync(join(dir, "src", "main.tsx"), "utf8");

    expect(entry).toContain('void import("@ramonda/query/devtools")');
    expect(entry).not.toContain("@ramonda/form/devtools");
  });

  test("the panel is still offered without them, and they without it", () => {
    const alone = make("spa", ["devtools"]).pkg;
    expect(alone.devDependencies["@ramonda/devtools"]).toBeDefined();
    expect(alone.dependencies["@ramonda/form"]).toBeUndefined();

    // A form with no panel installed registers into a registry nobody reads, which costs one Map
    // and is why neither add-on has to imply the other.
    const quiet = make("spa", ["form"]).pkg;
    expect(quiet.dependencies["@ramonda/form"]).toBeDefined();
    expect(quiet.devDependencies["@ramonda/devtools"]).toBeUndefined();
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

  test("SSR always has vite — it is the dev server, not just a test transform", () => {
    /**
     * SSR dev is a Vite middleware server (hot reload) rather than an esbuild build + Node
     * boot, so vite is a dependency of every SSR project, add-ons or none.
     */
    const { pkg } = make("ssr", []);
    expect(pkg.devDependencies.vite).toBeDefined();
  });
});

describe("the types a Vite project needs", () => {
  test("the SPA declares vite/client, so its css import and import.meta.env type-check", () => {
    /**
     * Both were reported on a project nobody had touched yet:
     *
     *   src/main.tsx  Cannot find module './style.css'
     *   src/main.tsx  Property 'env' does not exist on type 'ImportMeta'
     *
     * The code was right — Vite injects both — only the TYPES were missing, and the scaffolder
     * generates the `import.meta.env.DEV` guard itself, so it shipped a project that did not
     * type-check out of the box. Verified against a real scaffold: `tsc --noEmit` fails with the
     * second error without this file and passes with it.
     *
     * It is one `/// <reference types="vite/client" />`, where `npm create vite` puts it too.
     */
    const { read } = make("spa", []);
    const declaration = read("src/vite-env.d.ts");

    expect(declaration).toContain('/// <reference types="vite/client" />');
  });

  test("the SPA has vite to resolve those types against", () => {
    // A reference to a package that is not a dependency is a worse error than the one it fixes.
    const { pkg } = make("spa", []);
    expect(pkg.devDependencies.vite).toBeDefined();
  });

  test("SSR does not need it — esbuild, its own __DEV__, no css", () => {
    /**
     * The templates differ on purpose, so the check is that the SSR one still declares the
     * global it actually uses rather than acquiring a reference it does not.
     */
    const { read, dir } = make("ssr", []);
    expect(read("global.d.ts")).toContain("declare const __DEV__: boolean");
    expect(existsSync(join(dir, "src", "vite-env.d.ts"))).toBe(false);
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
    expect(ssr.read("src/entry-client.tsx")).toContain("if (__DEV__) {");
    expect(ssr.read("src/entry-client.tsx")).toContain('void import("@ramonda/devtools")');

    const spa = make("spa", ["devtools"]);
    expect(spa.read("src/main.tsx")).toContain("if (import.meta.env.DEV) {");
    expect(spa.read("src/main.tsx")).toContain('void import("@ramonda/devtools")');
  });

  test("is absent when the add-on was not chosen", () => {
    const { read, pkg } = make("spa", ["router"]);
    expect(read("src/main.tsx")).not.toContain("@ramonda/devtools");
    expect(pkg.devDependencies["@ramonda/devtools"]).toBeUndefined();
  });
});

describe("development is development", () => {
  test("SSR dev is the Vite server (development), and the build stays production", () => {
    const { pkg, read } = make("ssr", []);
    const scripts = (pkg as unknown as { scripts: Record<string, string> }).scripts;

    /**
     * `dev` is now a Vite middleware server with hot reload — `node server.mjs`, not an
     * esbuild build. Vite runs the app in development (diagnostics, strict render, devtools);
     * `vite.config.ts` sets `__DEV__` true. The production `build`/`start` path is unchanged
     * and still uses production conditions, so a scaffolded app never accidentally serves the
     * production core during development (the bug the old assertions guarded).
     */
    expect(scripts.dev).toBe("node server.mjs");
    expect(read("vite.config.ts")).toContain("__DEV__");
    expect(read("vite.config.ts")).toMatch(/__DEV__.*true/);
    expect(scripts["build:client"]).toContain("--conditions=production");
    expect(scripts["build:client"]).toContain("--define:__DEV__=false");
    expect(scripts.start).toContain("--prod");
  });
});

describe("ISR is cached somewhere a second instance can see", () => {
  test("the SSR server uses a store, not a Map of its own", () => {
    const { read, pkg } = make("ssr", []);
    const server = read("server.mjs");

    // A per-process Map was the original shape, and it is wrong the moment there are two
    // processes: each ages its own copy, so a visitor bounces between them, and a restart
    // renders every ISR route cold again.
    expect(server).toContain('from "@ramonda/router/server"');
    expect(server).toContain("createIsrCache");
    expect(server).toContain("fileStore");
    expect(server).not.toContain("isrCache = new Map");

    // server.mjs imports it at runtime, so the router has to be a real dependency — SSR always
    // adds it, add-on chosen or not.
    expect((pkg as unknown as { dependencies: Record<string, string> }).dependencies).toHaveProperty("@ramonda/router");
  });

  test("a build clears the cache, because those pages came from the old bundle", () => {
    const { read } = make("ssr", []);

    // Serving a page baked by the previous bundle against a new client bundle is a hydration
    // mismatch. The prerender step runs on every build, which makes it the one place this
    // cannot be forgotten.
    expect(read("scripts/prerender.mjs")).toContain('rm(resolve(root, "dist/isr")');
  });
});

describe("the scaffolded server shuts its DOM down through its own handle", () => {
  test("nothing reaches for jsdom's `window.close()`", () => {
    const { read } = make("ssr", []);
    const server = read("server.mjs");

    /**
     * The template renders into linkedom, which has a `window` but no `close` on it — so
     * `dom.window.close()` throws `TypeError` at the end of every ISR bake and every dynamic
     * render. It shipped that way: the line survived the move off jsdom because the only page a
     * test ever asked for was a prerendered static file, which is a file read and no render at all.
     *
     * The fix is that `installDom` answers with a handle rather than the DOM, so which DOM is
     * underneath stops being the caller's business. This asserts the shape, since a scaffolded
     * project's first ISR page is the thing that breaks.
     */
    expect(server).not.toContain("window.close()");
    expect(server).toContain("dom.close()");
    expect(server).toContain("return { close:");
  });
});

describe("the generated project declares what its own code needs", () => {
  test("the SSR template declares __DEV__, which guards the devtools import", () => {
    const { read } = make("ssr", ["devtools"]);

    // The entry says `if (__DEV__)`, so the project has to declare it or its own `tsc` fails.
    // esbuild replaces it per build: true for `dev`, false for `build`.
    expect(read("global.d.ts")).toContain("__DEV__");
  });

  test("the SPA template has no globals to declare at all", () => {
    const { dir, read } = make("spa", ["devtools"]);
    // Vite provides `import.meta.env.DEV`, and the JSX factory is imported per file by the
    // automatic runtime — so there is nothing left for a `global.d.ts` to say.
    expect(existsSync(join(dir, "global.d.ts"))).toBe(false);
    expect(read("src/main.tsx")).toContain("import.meta.env.DEV");
  });
});

/**
 * The decorators are the public API, and they are not parseable JavaScript in any engine. A build
 * that does not transform them emits a file that dies with `SyntaxError: Invalid or unexpected
 * token` the moment a browser reads it — not at build time, not in a test, but on the first page
 * load, in the user's project.
 *
 * That shipped here once. It had been working by accident: `esbuild.jsxInject` put an import in
 * every module, which forced every module through the esbuild transform, and that transform is
 * what strips the decorators. Nobody had chosen it. Removing `jsxInject`, for an unrelated
 * reason, broke the output in silence.
 *
 * Measured against esbuild 0.28.1: `--target=es2022` transforms decorators into helpers,
 * `--target=esnext` leaves `@Host("div")` verbatim, and `node --check` on that output is a
 * SyntaxError. So a scaffolded project's whole public API rests on one line of config — and
 * `esnext` reads like a modernisation, which is how it gets raised.
 *
 * Two guards, and both are needed. The target has to be set on every transform a scaffolded
 * project runs, and the reason has to be written where the setting is, or the next person to
 * tidy the config has nothing to read. Then the build parses what it emitted, so if both of
 * those are ever got wrong anyway, the build says so instead of the browser.
 */
describe("the decorators survive a scaffolded build", () => {
  /** Every transform in the generated project, with where it lives. */
  function transforms(read: (file: string) => string, scripts: Record<string, string>) {
    return [
      ["vite.config.ts", read("vite.config.ts")],
      ...Object.entries(scripts).filter(([, command]) => command.includes("esbuild ")),
    ] as [string, string][];
  }

  /** What each transform was actually told to target — the config object and the CLI flag alike. */
  function targetsIn(source: string) {
    return [...source.matchAll(/target:\s*"([^"]+)"/g), ...source.matchAll(/--target=(\S+)/g)].map((m) => m[1]);
  }

  test("every transform targets es2022 — never esnext, which leaves them in", () => {
    for (const mode of ["spa", "ssr"] as const) {
      const { read, pkg } = make(mode, []);
      const scripts = (pkg as unknown as { scripts: Record<string, string> }).scripts;
      const found = transforms(read, scripts);

      // Guards on the guard. If the config is ever restructured so no transform is found, or a
      // transform names no target and inherits esbuild's default, the loops below would pass over
      // an empty list and say nothing.
      expect(found.length).toBeGreaterThan(0);

      for (const [where, source] of found) {
        const targets = targetsIn(source);
        expect(targets.length, `${mode}/${where} names no target`).toBeGreaterThan(0);
        for (const target of targets) expect(`${mode}/${where} → ${target}`).toContain("es2022");
      }
    }
  });

  test("the config says why the target is there, next to the target", () => {
    // `server.mjs` already points at "the one setting (es2022) that makes this work with
    // decorators" — and pointed at a config that did not mention decorators at all. A reason
    // kept somewhere else is a reason nobody reads at the moment they are editing the line.
    for (const mode of ["spa", "ssr"] as const) {
      const { read } = make(mode, []);
      expect(read("vite.config.ts")).toMatch(/decorator/i);
    }
  });

  test("the build parses every file it emitted", () => {
    for (const mode of ["spa", "ssr"] as const) {
      const { pkg, read } = make(mode, []);
      const scripts = (pkg as unknown as { scripts: Record<string, string> }).scripts;

      // The check has to run over the build OUTPUT, so it has to come after the build, and the
      // `&&` chain has to keep it from running on a build that already failed.
      expect(scripts.build).toMatch(/&&\s*ramonda-check-bundle\s+\S+\s*$/);

      // And it has to be installable, which is the whole reason it moved out of the workspace's
      // private package: `@ramonda/check` is the one a generated project already has.
      expect(pkg.devDependencies).toHaveProperty("@ramonda/check");
      expect(read("package.json")).toContain("ramonda-check-bundle");
    }
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
