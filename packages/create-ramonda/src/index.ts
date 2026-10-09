import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  mkdirSync,
  renameSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir = resolve(here, "..", "templates");

// Version specifiers written into the generated package.json.
//
// `ramonda` is NOT a constant here: it is replaced at build time with a caret range over
// core's workspace version (see tsup.config.ts). It used to be `~0.0.1`, hand-maintained,
// and it went stale the moment core and query reached 0.1.0 — a fresh project's first
// install then failed with `No matching version found for @ramonda/query@~0.0.1`. Deriving
// it means a release cannot ship a scaffolder that pins versions it did not publish.
declare const __RAMONDA_RANGES__: Record<string, string>;

/**
 * The published range for a first-party package. Per package, not one for all of them: they
 * do not share a version line, and pinning them as if they did is exactly what broke a fresh
 * project's install.
 */
function ramonda(name: string): string {
  const range = __RAMONDA_RANGES__[name];
  if (!range) throw new Error(`[create-ramonda] no version known for ${name} — see tsup.config.ts`);
  return range;
}

declare const __TOOL_RANGES__: Record<string, string>;

/**
 * The range for a build tool, from whichever workspace package uses it (see tsup.config.ts).
 * Hand-written constants drifted: the template pinned vitest 3 while the framework moved to 4.
 */
function tool(name: string): string {
  const range = __TOOL_RANGES__[name];
  if (!range) throw new Error(`[create-ramonda] no version known for ${name} — see tsup.config.ts`);
  return range;
}

type Mode = "spa" | "ssr";
type AddOn = "css" | "router" | "query" | "form" | "lens" | "testing" | "devtools" | "biome";

interface Deps {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

/** Which package manager invoked us, read from npm's user-agent string. */
function detectPackageManager(): "npm" | "pnpm" | "yarn" | "bun" {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("bun")) return "bun";
  return "npm";
}

/** npm rejects a name with uppercase or leading dots; make a sane package name. */
function toPackageName(dir: string): string {
  const collapsed = basename(resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9-~]+/g, "-");

  // Trimmed by scanning, not by `replace(/^-+|-+$/g, "")`. That pattern's second half cannot match
  // a name which does not END in a dash, so the engine retries from every position inside a run and
  // backtracks all of it each time — quadratic. Measured on `a` + 40k dashes + `b`: 1.9s, against
  // 385ms at 20k. Only a folder name reaches here, so nothing hostile does; two loops are simply
  // the right way to trim, and unlike the regex they cannot be flagged.
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "-") start++;
  while (end > start && collapsed[end - 1] === "-") end--;

  return collapsed.slice(start, end) || "ramonda-app";
}

function isEmpty(dir: string): boolean {
  if (!existsSync(dir)) return true;
  const files = readdirSync(dir);
  return files.length === 0 || (files.length === 1 && files[0] === ".git");
}

/** Cancel helper: clack returns a symbol when the user hits Ctrl-C. */
// `Exclude` rather than `T | symbol`: a prompt answers with its own `unique symbol` on cancel, and
// that is not `symbol` to inference, so `T` swallowed it and every answer stayed a possible symbol.
function guard<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return value as Exclude<T, symbol>;
}

/**
 * The lowest Node this scaffolder will produce a working app on.
 *
 * `engines` in package.json is advisory — npm prints a warning, and `npm create` runs the CLI anyway. So
 * the check is here, where someone is watching, and it REFUSES rather than warns: everything after this
 * point writes files, and a project scaffolded on a Node that cannot run it is worse than no project.
 *
 * The number is not a guess about this CLI, which is plain `fs` and would run on much older. It is the
 * floor the generated app needs — Vite 7 requires `^20.19 || >=22.12` — rounded up to the version the
 * repo itself builds and tests on. Ramonda is `0.x` and has no users on old runtimes to keep faith with;
 * when that changes, this number is the one place to argue about it.
 */
export const MIN_NODE = 24;

/** Exported so the boundary can be tested without spawning a process per version. */
export function nodeIsOldEnough(version: string): boolean {
  return Number(version.split(".")[0]) >= MIN_NODE;
}

function requireNode(): void {
  if (nodeIsOldEnough(process.versions.node)) return;

  p.cancel(
    `create-ramonda needs Node ${MIN_NODE} or newer — this is Node ${process.versions.node}.\n` +
      `  The app it generates would not build: its toolchain requires it, whatever this CLI can run on.`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  console.log();
  p.intro(pc.magenta(pc.bold("🌸 create-ramonda")));
  requireNode();

  // Target directory — from argv or a prompt.
  const argTarget = process.argv[2];
  const target = guard(
    argTarget ??
      (await p.text({
        message: "Where should the app go?",
        placeholder: "ramonda-app",
        defaultValue: "ramonda-app",
      })),
  );
  const targetDir = resolve(process.cwd(), target);
  const name = toPackageName(targetDir);

  if (!isEmpty(targetDir)) {
    const overwrite = guard(
      await p.confirm({
        message: `${pc.yellow(relative(process.cwd(), targetDir) || ".")} is not empty. Continue and overwrite?`,
        initialValue: false,
      }),
    );
    if (!overwrite) {
      p.cancel("Left the directory untouched.");
      process.exit(0);
    }
  }

  const mode = guard(
    await p.select({
      message: "How should it render?",
      options: [
        { value: "spa" as Mode, label: "SPA", hint: "client-side, Vite — the simplest start" },
        { value: "ssr" as Mode, label: "SSR", hint: "server-rendered + hydrated, Node server" },
      ],
      initialValue: "spa" as Mode,
    }),
  );

  const addons = guard(
    await p.multiselect({
      message: "Add packages and tooling? " + pc.dim("(space to toggle, enter to confirm)"),
      required: false,
      options: [
        {
          value: "css" as AddOn,
          label: "CSS",
          hint: "@ramonda/css — style blocks, tokens, and a strict config to start from",
        },
        { value: "router" as AddOn, label: "Router", hint: "@ramonda/router — routes and links" },
        { value: "query" as AddOn, label: "Query", hint: "@ramonda/query — cached, race-free async data" },
        { value: "form" as AddOn, label: "Form", hint: "@ramonda/form — typed fields and schema validation" },
        { value: "lens" as AddOn, label: "Lens", hint: "@ramonda/lens — immutable state updates" },
        { value: "testing" as AddOn, label: "Testing", hint: "vitest + @ramonda/testing-library" },
        {
          value: "devtools" as AddOn,
          label: "Devtools",
          // Worth saying, because it is not obvious that the panel grows with the other choices:
          // a package that has something to show registers its own tab when it is used.
          hint: "@ramonda/devtools — dev inspector, with a tab per package you picked",
        },
        { value: "biome" as AddOn, label: "Biome", hint: "@biomejs/biome — lint + format in one tool" },
      ],
      initialValues: ["css" as AddOn, "devtools" as AddOn],
    }),
  );

  const doGit = guard(await p.confirm({ message: "Initialise a git repository?", initialValue: true }));
  const pm = detectPackageManager();
  const doInstall = guard(
    await p.confirm({ message: `Install dependencies with ${pc.cyan(pm)}?`, initialValue: true }),
  );

  const s = p.spinner();
  s.start("Scaffolding");

  scaffold({ targetDir, name, mode, addons });

  s.stop("Scaffolded " + pc.green(relative(process.cwd(), targetDir) || "."));

  if (doGit) {
    const git = spawnSync("git", ["init", "-q"], { cwd: targetDir, stdio: "ignore" });
    if (git.status === 0) p.log.step("Initialised a git repository");
  }

  if (doInstall) {
    const inst = p.spinner();
    inst.start(`Installing with ${pm}`);
    // `pipe`, not `ignore`: this step swallowed its own output, so the pnpm error that made
    // every fresh SSR project fail to start was invisible until someone ran the install by
    // hand. The reason is the useful part of a failure.
    const res = spawnSync(pm, ["install"], { cwd: targetDir, encoding: "utf8" });
    if (res.status === 0) {
      inst.stop("Installed dependencies");
    } else {
      inst.stop(pc.yellow(`\`${pm} install\` failed — run it yourself in the project.`));
      const reason = firstUsefulLine(`${res.stderr ?? ""}\n${res.stdout ?? ""}`);
      if (reason) p.log.warn(reason);
    }
  }

  const run = pm === "npm" ? "npm run" : pm;
  const cd = relative(process.cwd(), targetDir);
  p.note(
    [cd ? pc.dim("$ ") + `cd ${cd}` : "", doInstall ? "" : pc.dim("$ ") + `${pm} install`, pc.dim("$ ") + `${run} dev`]
      .filter(Boolean)
      .join("\n"),
    "Next steps",
  );

  p.outro(`${pc.magenta("Ramonda")} is ready. Docs: ${pc.underline("https://ramonda.dev")}`);
}

export interface ScaffoldOptions {
  targetDir: string;
  name: string;
  mode: Mode;
  addons: AddOn[];
}

/**
 * The line worth showing from a failed install: an explicit error if there is one, otherwise
 * the last non-empty line. A package manager's output is mostly progress.
 */
function firstUsefulLine(output: string): string | undefined {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) => /err|error|fail/i.test(line)) ?? lines[lines.length - 1];
}

export function scaffold({ targetDir, name, mode, addons }: ScaffoldOptions): void {
  mkdirSync(targetDir, { recursive: true });

  // Copy the base template for the chosen mode.
  cpSync(join(templatesDir, mode), targetDir, { recursive: true });

  // npm refuses to publish a file literally named `.gitignore`, so it ships as
  // `_gitignore`; restore the real name in the generated project.
  const gi = join(targetDir, "_gitignore");
  if (existsSync(gi)) renameSync(gi, join(targetDir, ".gitignore"));

  // Compose dependencies from the base + the chosen add-ons.
  const deps: Deps = { dependencies: {}, devDependencies: {} };
  deps.dependencies["@ramonda/core"] = ramonda("@ramonda/core");

  // The SSR template is a routed app — its SSG/SSR/ISR pipeline (per-route rendering modes)
  // is built on the router — so SSR always includes it, add-on chosen or not.
  if (addons.includes("router") || mode === "ssr") deps.dependencies["@ramonda/router"] = ramonda("@ramonda/router");
  if (addons.includes("query")) deps.dependencies["@ramonda/query"] = ramonda("@ramonda/query");
  if (addons.includes("form")) deps.dependencies["@ramonda/form"] = ramonda("@ramonda/form");
  if (addons.includes("lens")) deps.dependencies["@ramonda/lens"] = ramonda("@ramonda/lens");
  // A dependency, not a tool: a compiled block imports its runtime from the package.
  if (addons.includes("css")) {
    deps.dependencies["@ramonda/css"] = ramonda("@ramonda/css");
    useStyleBlocks(targetDir, mode);
  }
  if (addons.includes("devtools")) {
    deps.devDependencies["@ramonda/devtools"] = ramonda("@ramonda/devtools");
    importDevtools(targetDir, mode, addons);
  }

  if (mode === "spa") {
    deps.devDependencies["vite"] = tool("vite");
  } else {
    // SSR: prod is an esbuild bundle served by a Node process that needs a DOM;
    // dev is a Vite middleware server (hot reload) — see server.mjs.
    //
    deps.devDependencies["vite"] = tool("vite");
    deps.devDependencies["esbuild"] = tool("esbuild");
    // The DOM installer, the shell fill and the cookie parser, from one place. They used to be
    // written into `server.mjs` and `scripts/prerender.mjs` per project, and the two copies drifted
    // — one moved to linkedom and the other did not, and the build died at prerender.
    //
    // A DEPENDENCY, and it brings its own DOM. The generated project names no DOM library at all:
    // linkedom was a devDependency here while `server.mjs` needed it to start, so `npm ci
    // --omit=dev` produced a project that built and then died on `ERR_MODULE_NOT_FOUND` — the very
    // fault this package was extracted to end. jsdom is still installed by the `testing` add-on
    // below, where it stands in for a BROWSER rather than a server.
    deps.dependencies["@ramonda/server"] = ramonda("@ramonda/server");
  }
  // The static context check runs as the first step of `build`, so a consumer that lost its
  // provider fails the build instead of quietly falling back to the default in someone's browser.
  // Its second binary, `ramonda-check-bundle`, runs at the END and parses what the build emitted.
  deps.devDependencies["@ramonda/check"] = ramonda("@ramonda/check");
  // Owns the three transform settings — `jsx`, `jsxImportSource`, `target` — so the generated
  // project names none of them. Both modes: the SPA config and the SSR dev server take the Vite
  // plugin, and the SSR production build spreads the esbuild options.
  deps.devDependencies["@ramonda/build"] = ramonda("@ramonda/build");
  deps.devDependencies["typescript"] = tool("typescript");
  deps.devDependencies["@types/node"] = tool("@types/node");

  if (addons.includes("testing")) {
    deps.devDependencies["vitest"] = tool("vitest");
    deps.devDependencies["@ramonda/testing-library"] = ramonda("@ramonda/testing-library");
    // Both modes now: the SSR server uses linkedom, so a scaffolded SSR project no longer has jsdom
    // from anywhere else — and `environment: "jsdom"` below would fail on a missing package.
    deps.devDependencies["jsdom"] = tool("jsdom");
    // `vite` is a PEER dependency of vitest (`^6 || ^7 || ^8`), and without it vitest has no
    // transform: measured on a scaffolded SSR project, where the .tsx reached the runtime
    // unchanged and the suite died with `SyntaxError: Invalid or unexpected token`. The SPA
    // template had it already, which is why only SSR was broken.
    deps.devDependencies["vite"] = tool("vite");
    writeTestingFiles(targetDir, mode, addons.includes("css"));
  }

  if (addons.includes("biome")) {
    deps.devDependencies["@biomejs/biome"] = tool("@biomejs/biome");
    writeBiomeConfig(targetDir, addons.includes("css"));
  }

  writePnpmSettings(targetDir);

  // Merge into the template's package.json, keeping its scripts.
  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  pkg.name = name;
  pkg.dependencies = sortKeys({ ...(pkg.dependencies as object), ...deps.dependencies });
  pkg.devDependencies = sortKeys({ ...(pkg.devDependencies as object), ...deps.devDependencies });
  const extraScripts: Record<string, string> = {};
  if (addons.includes("testing")) extraScripts.test = "vitest";
  if (addons.includes("biome")) {
    // Biome cannot read a style block, so with blocks `src` goes through `ramonda-css`, which runs
    // this project's own biome over what it can parse and maps every position home. Biome's own run
    // takes the rest; `biome.json` leaves `src` out of it.
    const blocks = addons.includes("css");
    extraScripts.lint = blocks ? "biome lint . && ramonda-css lint src" : "biome lint .";
    extraScripts.format = blocks ? "biome format --write . && ramonda-css format src" : "biome format --write .";
  }
  // `tsc` cannot read a style block; `ramonda-css` is the same check with blocks read.
  if (addons.includes("css")) extraScripts.typecheck = "ramonda-css";
  if (Object.keys(extraScripts).length > 0) {
    pkg.scripts = { ...(pkg.scripts as object), ...extraScripts };
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

/**
 * The `css` add-on: the page written in style blocks, under a strict `ramonda.css.ts`.
 *
 * The files that DIFFER are whole files in `templates/css/` — the config, and each mode's page.
 * Everything else is one line added to a file the base template already has, so that file has one
 * copy; each edit names the text it expects, and throws when the template no longer has it, so a
 * changed template fails the scaffolder's tests rather than producing a project without its plugin.
 */
function useStyleBlocks(targetDir: string, mode: Mode): void {
  cpSync(join(templatesDir, "css", "ramonda.css.ts"), join(targetDir, "ramonda.css.ts"));
  // What codegen writes from that config, committed beside it in this repository — so an editor
  // opened before the first `dev` already reads the tokens. The repository's own gate fails when it
  // no longer matches the config, so it cannot ship stale.
  cpSync(join(templatesDir, "css", "css-system"), join(targetDir, "css-system"), { recursive: true });
  cpSync(join(templatesDir, "css", mode), targetDir, { recursive: true });

  edit(join(targetDir, "vite.config.ts"), [
    [
      'import { ramonda } from "@ramonda/build/vite";\n',
      'import { ramonda } from "@ramonda/build/vite";\nimport { ramondaCss } from "@ramonda/css/vite";\n',
    ],
    ["plugins: [ramonda()],", "plugins: [ramonda(), ramondaCss()],"],
  ]);

  if (mode === "spa") return;

  edit(join(targetDir, "scripts", "build.mjs"), [
    [
      'import { ramondaOptions, ramondaDefine } from "@ramonda/build/esbuild";\n',
      'import { ramondaOptions, ramondaDefine } from "@ramonda/build/esbuild";\nimport { ramondaCss } from "@ramonda/css/esbuild";\n',
    ],
    [
      "  // Where a bundler plugin goes, in both builds at once — `@ramonda/css`'s, for instance.\n  plugins: [],",
      "  // The style blocks, in both builds at once. `filter` names the files that may hold one,\n" +
        "  // because esbuild hands a plugin a path rather than the code.\n" +
        "  plugins: [ramondaCss({ filter: /src\\/.*\\.tsx$/ })],",
    ],
  ]);

  // The shell keeps only what a block cannot reach: the document itself.
  const shell = join(targetDir, "index.html");
  const html = readFileSync(shell, "utf8");
  const style = /    <style>[\s\S]*?<\/style>\n/;
  if (!style.test(html)) throw new Error("[create-ramonda] the SSR index.html has no <style> to replace");
  writeFileSync(shell, html.replace(style, readFileSync(join(templatesDir, "css", "shell-style.html"), "utf8")));
}

/** Each `[from, to]` once, in order — and a `from` the file does not hold is the template having moved. */
function edit(file: string, changes: readonly (readonly [string, string])[]): void {
  let text = readFileSync(file, "utf8");
  for (const [from, to] of changes) {
    if (!text.includes(from)) throw new Error(`[create-ramonda] ${file} no longer holds: ${from}`);
    text = text.replace(from, to);
  }
  writeFileSync(file, text);
}

/**
 * Imports the devtools panel from the app's entry, so it actually appears.
 *
 * ## Why the app has to ask
 *
 * Core loads the panel itself in a development build, but through a dynamic import whose
 * specifier is a VARIABLE and marked `@vite-ignore` — deliberately, so that `@ramonda/core`
 * does not make `@ramonda/devtools` a resolution requirement for every project that
 * type-checks it. A bundler therefore leaves the string alone, the browser tries to fetch
 * `@ramonda/devtools` as a URL, and core's `.catch()` swallows the failure by design (the
 * panel is optional). The result is silence: the add-on was installed and no badge ever
 * appeared. Measured on a scaffolded project before this.
 *
 * One line in the entry fixes it, and it belongs there rather than in core: the app is what
 * knows the panel was installed.
 *
 * Guarded so a production build drops it — `import.meta.env.DEV` for vite, `__DEV__` for the
 * esbuild templates, which now define it per build.
 */
function importDevtools(targetDir: string, mode: Mode, addons: readonly AddOn[]): void {
  const entry = mode === "spa" ? join(targetDir, "src", "main.tsx") : join(targetDir, "src", "entry-client.tsx");
  if (!existsSync(entry)) return;

  const guard = mode === "spa" ? "import.meta.env.DEV" : "__DEV__";

  /**
   * A tab per package that has one, and each is its own import.
   *
   * A package ANNOUNCES what it holds with an event and never imports the module that describes
   * it — so that description is only in the bundle of an app that asked for it. That is why these
   * are separate lines rather than something `@ramonda/devtools` pulls in: it cannot reach them,
   * and should not be able to.
   */
  const panels: string[] = [];
  if (addons.includes("query")) panels.push('  void import("@ramonda/query/devtools");');
  if (addons.includes("form")) panels.push('  void import("@ramonda/form/devtools");');

  const body = ['  void import("@ramonda/devtools");', ...panels].join("\n");
  const line = `
// The devtools panel — press Alt+D, or click the flower badge. Development only: this
// branch is dropped from a production build, so the panel is never shipped.
if (${guard}) {
${body}
}
`;

  writeFileSync(entry, `${readFileSync(entry, "utf8").trimEnd()}\n${line}`);
}

/**
 * Lets pnpm run esbuild's install script, without which a scaffolded project does not start.
 *
 * ## What goes wrong without it
 *
 * pnpm 10, 11 and 12 refuse to run a dependency's build scripts until the project says which are
 * allowed, and they exit NON-ZERO when any were skipped:
 *
 * ```
 * [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.1
 * ```
 *
 * esbuild's script is what puts its platform binary in place, so `pnpm dev` then fails on
 * every fresh project — measured on both templates, because SSR depends on esbuild directly
 * and the SPA gets it through vite.
 *
 * This monorepo did not catch it at the time: it pinned `pnpm@9.0.0`, which had no such gate.
 *
 * ## Why both keys, and why a YAML file rather than package.json
 *
 * `pnpm-workspace.yaml` is where pnpm 10+ keeps settings, workspace or not — pnpm 11 writes
 * one itself when it wants an answer. The key changed between versions, so both are written:
 * `allowBuilds` is pnpm 11's and 12's, `onlyBuiltDependencies` is pnpm 10's. Verified against
 * each (11: exit 0 with either, 10: exit 0 with both, 12.10.1: exit 0 with both and no warning
 * about the key it does not read).
 *
 * The `pnpm` field in package.json is deliberately NOT used: pnpm 11 and 12 warn that they no
 * longer read it.
 *
 * Written for every project rather than only for pnpm users. It is four lines, npm and yarn
 * ignore it, and the alternative is a project that breaks for whoever clones it with pnpm.
 */
function writePnpmSettings(targetDir: string): void {
  writeFileSync(
    join(targetDir, "pnpm-workspace.yaml"),
    `# esbuild needs its install script to put the platform binary in place. pnpm 11+ reads
# \`allowBuilds\`, pnpm 10 reads \`onlyBuiltDependencies\`; both are here so either works.
allowBuilds:
  esbuild: true
onlyBuiltDependencies:
  - esbuild
`,
  );
}

/** A vitest config + one example test, dropped in when the Testing add-on is picked. */
/**
 * `vitest.config.ts` takes the plugins the app's own Vite config takes, because the tests go through
 * the same transform. It held an `esbuild` block once, and on Vite 8 that reaches Oxc only as JSX
 * settings — the decorators stayed in and the first `vitest run` died with a `SyntaxError`.
 */
function writeTestingFiles(targetDir: string, mode: Mode, css: boolean): void {
  writeFileSync(
    join(targetDir, "vitest.config.ts"),
    `import { defineConfig } from "vitest/config";
import { ramonda } from "@ramonda/build/vite";
${css ? 'import { ramondaCss } from "@ramonda/css/vite";\n' : ""}
export default defineConfig({
  plugins: [ramonda()${css ? ", ramondaCss()" : ""}],
  test: {
    environment: "jsdom",
  },
});
`,
  );

  const dir = mode === "spa" ? join(targetDir, "src") : join(targetDir, "src");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "App.test.tsx"),
    `import { expect, test } from "vitest";
import { render } from "@ramonda/testing-library";
import { App } from "./App";

test("renders the heading", () => {
  const { container } = render(<App />);
  expect(container.textContent).toContain("Ramonda");
});
`,
  );
}

/**
 * A Biome config, dropped in when the Biome add-on is picked — one tool for both
 * linting and formatting. `preset: "recommended"` is Biome 2.x's non-deprecated way
 * to turn on the recommended lint rules; `vcs.useIgnoreFile` keeps it off .gitignored
 * paths (dist, node_modules). The schema version tracks tool("@biomejs/biome") so the two never drift.
 */
function writeBiomeConfig(targetDir: string, blocks: boolean): void {
  const version = tool("@biomejs/biome").replace(/^\D*/, "");
  const config = {
    $schema: `https://biomejs.dev/schemas/${version}/schema.json`,
    vcs: { enabled: true, clientKind: "git", useIgnoreFile: true },
    files: {
      ignoreUnknown: true,
      // `src` is the wrapper's — see the scripts — and the build's output and the generated tokens
      // are nobody's to lint or format.
      ...(blocks ? { includes: ["**", "!src", "!dist", "!css-system"] } : {}),
    },
    formatter: { enabled: true, indentStyle: "space", indentWidth: 2, lineWidth: 120 },
    linter: { enabled: true, rules: { preset: "recommended" } },
    javascript: { formatter: { quoteStyle: "double" } },
  };
  // A list of short strings on one line, which is how biome itself writes one — so the project's
  // first `biome format .` does not report the config it was given.
  const text = JSON.stringify(config, null, 2).replace(
    /\[\n\s*("[^"\n]*",?\n\s*)+\]/g,
    (list) =>
      `[${list
        .slice(1, -1)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")}]`,
  );
  writeFileSync(join(targetDir, "biome.json"), text + "\n");
}

function sortKeys(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

// Run the interactive flow when invoked as the CLI. Compare REAL paths: npm/npx
// run the bin through a symlink (node_modules/.bin/create-ramonda), so
// `process.argv[1]` is the symlink while `import.meta.url` is the real file —
// a raw string compare fails and nothing happens. `realpathSync` resolves both.
let invokedAsCli = false;
try {
  invokedAsCli =
    Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
} catch {
  invokedAsCli = false;
}
if (invokedAsCli) {
  main().catch((err) => {
    p.log.error(String(err instanceof Error ? err.stack : err));
    process.exit(1);
  });
}
