// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, test } from "vitest";

/**
 * Builds a real application and reads what came out: a production build must contain no
 * diagnostic, no diagnostic message, and no devtools.
 *
 * ## Why a build rather than a unit test
 *
 * Every check in the framework is wrapped in `if (__DEV__)`, and that is not a runtime
 * flag — it is a compile-time constant the app's bundler replaces, so whether the code
 * survives is a property of the BUILD, not of any function. A unit test cannot see it.
 * What can go wrong is invisible from inside: a diagnostic reached from a code path that
 * is not itself gated, a `__DEV__` check written inside a function that ships anyway
 * (the string survives even when the branch is dead), or a devtools import that a
 * bundler decides to keep. Each of those has one symptom — a production bundle carrying
 * development code — and one place it shows: the emitted files.
 *
 * The precedent is `ramonda-check-bundle`, which parses every emitted file because a
 * build once shipped syntax no engine could read and nothing noticed. Same shape here.
 *
 * ## Why a fixture, and not this site's own bundle
 *
 * The docs site ships the diagnostics reference as CONTENT — `RMD001` appears in its
 * chunks as data, correctly. A grep cannot tell that from a leak, exactly as
 * `check-bundle` parses instead of grepping for `@` because demos ship decorator text
 * inside strings. So the app under test is a fixture that imports the framework and
 * nothing else: anything matching in ITS output came from the framework.
 *
 * The fixture touches every published package, because each carries its own codes
 * (`RMD*` in core, `RMQ*` in query) and a build only strips what it can see is dead.
 *
 * ## Why it also builds with `__DEV__=true`
 *
 * A test that greps for absent strings passes when the grep is broken, when the alias is
 * wrong, when the fixture tree-shook everything away. The development build is the
 * control: the same patterns, over the same fixture, must be FOUND there. Without it
 * this file could go green while checking nothing, which is the failure mode of every
 * "assert it is not there" test.
 */

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "..");
const packages = join(app, "..", "..", "packages");

const run = promisify(execFile);

/**
 * The same aliases this site's real build uses (see `build:client` in package.json), with
 * one deliberate difference: `@ramonda/devtools` points at the REAL package rather than
 * the stub. Stubbing it would prove nothing — the question is whether a production build
 * pulls the panel in when it is genuinely installed.
 */
const ALIASES = [
  // The subpaths FIRST: an esbuild alias also matches `<key>/…`, so the bare `@ramonda/core`
  // below would otherwise rewrite them to `…/index.ts/jsx-runtime`.
  `--alias:@ramonda/core/jsx-dev-runtime=${join(packages, "core/src/jsx-dev-runtime.ts")}`,
  `--alias:@ramonda/core/jsx-runtime=${join(packages, "core/src/jsx-runtime.ts")}`,
  `--alias:@ramonda/core=${join(packages, "core/src/index.ts")}`,
  `--alias:@ramonda/query=${join(packages, "query/src/index.ts")}`,
  `--alias:@ramonda/router=${join(packages, "router/src/index.ts")}`,
  `--alias:@ramonda/lens=${join(packages, "lens/src/index.ts")}`,
  `--alias:@ramonda/devtools=${join(packages, "devtools/src/index.ts")}`,
];

/**
 * An app that uses the framework the way an app does, and holds onto every import so
 * nothing is tree-shaken for being unreferenced — the point is what a build KEEPS.
 *
 * `bootstrap` is not called: this runs in node, and mounting is not what is being
 * measured. Reachability is.
 */
const FIXTURE = `
import { Component, Hook, bootstrap, list, StableProps, state, compute, mounted, updated, watchProp, memoizedHandler, configureDev, hydrateRoot } from "@ramonda/core";
import { Query, Mutation, QueryClient, QueryClientProvider } from "@ramonda/query";
import { Router, RouteOutlet, Navigator, Anchor, createRoutes } from "@ramonda/router";

@StableProps("id")
class Row extends Hook {
  @state count = 0;
  @compute get doubled() { return this.count * 2; }
  @watchProp((p) => p.id)
  onId() { this.count = 0; }
}

class App extends Component {
  @state items = [1, 2, 3];
  row = this.use(Row, (self) => ({ id: [self.items.length] }));
  query = this.use(Query, (self) => ({ key: ["rows"], fetch: self.load }));

  load() { return Promise.resolve([]); }

  @mounted start() {}
  @updated after() {}

  @memoizedHandler
  pick(id) { return () => { this.items = [id]; }; }

  render() {
    return h("div", null, list(this.items, this.pick));
  }
}

globalThis.__fixture = [
  App, Row, bootstrap, hydrateRoot, configureDev, Mutation, QueryClient, QueryClientProvider,
  Router, RouteOutlet, Navigator, Anchor, createRoutes,
];
`;

interface Build {
  code: string;
  files: string[];
}

type Mode = "minified" | "names-kept" | "dev";

/**
 * `names-kept` is `--minify-syntax --minify-whitespace` WITHOUT `--minify-identifiers`:
 * dead code is removed, so it is a real production build, but function names survive so
 * the test can assert on them. A plain unminified build cannot answer that question at
 * all — esbuild leaves `if (false) { … }` bodies in place when nothing asks it to
 * simplify, so every check would appear "present" while being unreachable.
 *
 * That is also the honest statement of how `__DEV__` stripping works: it needs the
 * bundler's dead-code pass, which vite/rollup run by default in build mode and esbuild
 * runs under minification. A production build with all optimisation switched off ships
 * the diagnostics — dead, but present.
 */
async function build(mode: Mode): Promise<Build> {
  const dev = mode === "dev";
  const flags = mode === "names-kept" ? ["--minify-syntax", "--minify-whitespace"] : dev ? ["--minify"] : ["--minify"];
  const out = await mkdtemp(join(tmpdir(), "ramonda-prod-build-"));
  const entry = join(out, "app.tsx");
  await run("node", ["-e", `require("fs").writeFileSync(${JSON.stringify(entry)}, ${JSON.stringify(FIXTURE)})`]);

  await run("npx", [
    "esbuild",
    entry,
    "--bundle",
    "--format=esm",
    "--splitting",
    "--jsx=automatic",
    "--jsx-import-source=@ramonda/core",
    `--define:__DEV__=${dev ? "true" : "false"}`,
    "--target=es2022",
    ...flags,
    ...ALIASES,
    `--outdir=${join(out, "dist")}`,
  ]);

  const dist = join(out, "dist");
  const files = (await readdir(dist)).filter((name) => name.endsWith(".js"));
  const chunks = await Promise.all(files.map((name) => readFile(join(dist, name), "utf8")));

  await rm(out, { recursive: true, force: true });
  return { code: chunks.join("\n"), files };
}

/**
 * The codes a production build MAY carry, each with the text it must appear inside.
 *
 * All three are deliberate, and they are deliberate for two different reasons:
 *
 * - `RMD004` / `RMD015` — writing to props THROWS in every build, not only in
 *   development. Read-only inputs are a rule, not a warning, so the error and its code
 *   ship. Dropping the code from the message would leave a developer with a thrown
 *   string and nothing to search for.
 * - `RMD009` — production has its own blunt update-loop stop, a counter that throws
 *   before the tab freezes, and its message points at the development diagnostic that
 *   names the actual component. That pointer is the value of the message.
 *
 * Anything else appearing is a leak: it means a spec object — and therefore `diagnose`
 * and every diagnostic's title and fix text — is reachable. Not hypothetical: writing a
 * DEV gate as `if (!__DEV__) return …` with the checks after it, rather than wrapping
 * them in `if (__DEV__) { … }`, left `checkPropsStability` referenced and pulled all 21
 * specs into the bundle. This test is what found it.
 */
const ALLOWED_CODES: Record<string, string> = {
  RMD004: "read-only",
  RMD009: "development build",
  RMD015: "read-only",
};

/** What must never reach a production build, with a name for the failure message. */
const FORBIDDEN: [string, RegExp][] = [
  ["the diagnostic banner", /Ramonda (Warning|Error)/],
  ["a diagnostic message", /must be pure|does not come from state|built a new value/],
  ["the development-mode greeting", /development mode is active/],
  ["the devtools bridge", /ramonda:(dev-log|devtools-ready|devtools-watch|logs-sync|tick)/],
  ["the devtools panel", /ramonda-devtools|RamondaDevTools/],
  ["the devtools toggle", /ramonda:toggle-devtools/],
];

/**
 * Three builds, because they answer different questions. String literals survive
 * minification, so the shipped build is where the forbidden TEXT is checked; identifiers
 * do not, so "the check function is gone" is asked of a build that keeps names.
 */
let prod: Build;
let prodNames: Build;
let dev: Build;

beforeAll(async () => {
  [prod, prodNames, dev] = await Promise.all([build("minified"), build("names-kept"), build("dev")]);
}, 180_000);

describe("a production application build", () => {
  test("emitted something, and it is the framework", () => {
    // Guards the whole file against passing because the build produced nothing, or
    // because the fixture failed to pull the framework in.
    expect(prod.files.length).toBeGreaterThan(0);
    expect(prod.code.length).toBeGreaterThan(5_000);
    expect(prod.code).toContain("RAMONDA-HOST");
  });

  test("carries no diagnostic code beyond the three that ship on purpose", () => {
    const codes = [...new Set(prod.code.match(/RM[DQ]\d{3}/g) ?? [])].sort();
    expect(codes).toEqual(Object.keys(ALLOWED_CODES).sort());
  });

  test("and each of those is inside the message it belongs to, not a spec", () => {
    // A code sitting in a spec object would pass the test above while meaning the
    // opposite, so each allowed one has to be found in its own context.
    for (const [code, context] of Object.entries(ALLOWED_CODES)) {
      const at = prod.code.indexOf(code);
      const around = prod.code.slice(Math.max(0, at - 200), at + 400);
      expect(around, `${code} is not in the message it is supposed to be part of`).toContain(context);
    }
  });

  for (const [what, pattern] of FORBIDDEN) {
    test(`ships no ${what}`, () => {
      const match = prod.code.match(pattern);
      expect(
        match === null,
        match ? `found ${JSON.stringify(match[0])} in the production bundle — see ${prod.files.join(", ")}` : "",
      ).toBe(true);
    });
  }

  test("the development build DOES carry all of it — so the checks above mean something", () => {
    const missing = FORBIDDEN.filter(([, pattern]) => !pattern.test(dev.code)).map(([what]) => what);
    expect(missing).toEqual([]);
  });

  test("the production build is smaller than the development one", () => {
    // Not a size budget — a sanity check that the two builds really differ, in the
    // direction stripping implies.
    expect(prod.code.length).toBeLessThan(dev.code.length);
  });

  test("no check function is even present, by name", () => {
    // Read from the unminified build, because this is a claim about identifiers. A
    // string being absent could mean the message was moved; a FUNCTION being absent
    // means the code that would have called it is gone too.
    for (const fn of [
      "checkRenderStability",
      "checkPropsStability",
      "installPurityGuard",
      "installTimerGuard",
      "initDevtoolsBridge",
      "recordDefinition",
      "startRecording",
      // A private METHOD survived here once — `reportIgnoredError(){}`, body stripped, declaration
      // left, because nothing can prove a class method unused. It is a module function now, and this
      // line is what stops it going back.
      "reportIgnoredError",
      "diagnose",
      "ramondaLog",
    ]) {
      expect(prodNames.code, `${fn} reached the production build`).not.toContain(fn);
    }
  });

  test("development-only strings do not reach the build", () => {
    /**
     * Text that exists only to be read in devtools. Unlike a diagnostic code this never appears in
     * the docs, so its presence in the bundle would mean exactly one thing: a development-only
     * value declared where the guard could not remove it.
     */
    for (const text of ["not read by this consumer"]) {
      expect(prod.code, `"${text}" reached the production build`).not.toContain(text);
      expect(prodNames.code, `"${text}" reached the names-kept build`).not.toContain(text);
    }
  });

  test("configureDev survives as a callable no-op", () => {
    // The one piece of the development surface that must NOT be stripped: an app calls
    // it unconditionally at startup, so a production build that dropped it would fail
    // at load with "not a function". It is the reason the switch is a real export
    // rather than a DEV-only one.
    expect(prodNames.code).toContain("configureDev");
  });

  test("@StableProps is NOT development-only — it is behaviour, not a check", () => {
    // The declaration shapes what the app DOES (one identity while the contents are equal),
    // so unlike every check above it must survive into the production build. RMD022 names it
    // as the fix; a build that stripped it would silently change how props update, and the
    // report would be recommending something that does nothing.
    expect(prodNames.code).toContain("resolveStable");
  });
});
