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

const V = {
  vite: "^7.3.6",
  typescript: "^5.9.3",
  typesNode: "^26.1.1",
  vitest: "^3.2.4",
  jsdom: "^28.0.0",
  esbuild: "^0.28.1",
  biome: "^2.5.5",
};

type Mode = "spa" | "ssr";
type AddOn = "router" | "query" | "lens" | "testing" | "devtools" | "biome";

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
  return (
    basename(resolve(dir))
      .toLowerCase()
      .replace(/[^a-z0-9-~]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ramonda-app"
  );
}

function isEmpty(dir: string): boolean {
  if (!existsSync(dir)) return true;
  const files = readdirSync(dir);
  return files.length === 0 || (files.length === 1 && files[0] === ".git");
}

/** Cancel helper: clack returns a symbol when the user hits Ctrl-C. */
function guard<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return value as T;
}

async function main(): Promise<void> {
  console.log();
  p.intro(pc.magenta(pc.bold("🌸 create-ramonda")));

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
        { value: "router" as AddOn, label: "Router", hint: "@ramonda/router — routes and links" },
        { value: "query" as AddOn, label: "Query", hint: "@ramonda/query — cached, race-free async data" },
        { value: "lens" as AddOn, label: "Lens", hint: "@ramonda/lens — immutable state updates" },
        { value: "testing" as AddOn, label: "Testing", hint: "vitest + @ramonda/testing-library" },
        { value: "devtools" as AddOn, label: "Devtools", hint: "@ramonda/devtools — dev inspector" },
        { value: "biome" as AddOn, label: "Biome", hint: "@biomejs/biome — lint + format in one tool" },
      ],
      initialValues: ["devtools" as AddOn],
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

  p.outro(`${pc.magenta("Ramonda")} is ready. Docs: ${pc.underline("https://ramonda.pages.dev")}`);
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

  if (addons.includes("router")) deps.dependencies["@ramonda/router"] = ramonda("@ramonda/router");
  if (addons.includes("query")) deps.dependencies["@ramonda/query"] = ramonda("@ramonda/query");
  if (addons.includes("lens")) deps.dependencies["@ramonda/lens"] = ramonda("@ramonda/lens");
  if (addons.includes("devtools")) {
    deps.devDependencies["@ramonda/devtools"] = ramonda("@ramonda/devtools");
    importDevtools(targetDir, mode);
  }

  if (mode === "spa") {
    deps.devDependencies["vite"] = V.vite;
  } else {
    // SSR builds with esbuild and serves through a Node process that needs a DOM.
    deps.devDependencies["esbuild"] = V.esbuild;
    deps.devDependencies["jsdom"] = V.jsdom;
  }
  deps.devDependencies["typescript"] = V.typescript;
  deps.devDependencies["@types/node"] = V.typesNode;

  if (addons.includes("testing")) {
    deps.devDependencies["vitest"] = V.vitest;
    deps.devDependencies["@ramonda/testing-library"] = ramonda("@ramonda/testing-library");
    if (mode === "spa") deps.devDependencies["jsdom"] = V.jsdom;
    writeTestingFiles(targetDir, mode);
  }

  if (addons.includes("biome")) {
    deps.devDependencies["@biomejs/biome"] = V.biome;
    writeBiomeConfig(targetDir);
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
    extraScripts.lint = "biome lint .";
    extraScripts.format = "biome format --write .";
  }
  if (Object.keys(extraScripts).length > 0) {
    pkg.scripts = { ...(pkg.scripts as object), ...extraScripts };
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
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
function importDevtools(targetDir: string, mode: Mode): void {
  const entry = mode === "spa" ? join(targetDir, "src", "main.tsx") : join(targetDir, "src", "entry-client.tsx");
  if (!existsSync(entry)) return;

  const guard = mode === "spa" ? "import.meta.env.DEV" : "__DEV__";
  const line = `
// The devtools panel — press Alt+D, or click the flower badge. Development only: this
// branch is dropped from a production build, so the panel is never shipped.
if (${guard}) void import("@ramonda/devtools");
`;

  writeFileSync(entry, `${readFileSync(entry, "utf8").trimEnd()}\n${line}`);
}

/**
 * Lets pnpm run esbuild's install script, without which a scaffolded project does not start.
 *
 * ## What goes wrong without it
 *
 * pnpm 10 and 11 refuse to run a dependency's build scripts until the project says which are
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
 * This monorepo could not have caught it: it pins `pnpm@9.0.0`, which has no such gate.
 *
 * ## Why both keys, and why a YAML file rather than package.json
 *
 * `pnpm-workspace.yaml` is where pnpm 10+ keeps settings, workspace or not — pnpm 11 writes
 * one itself when it wants an answer. The key changed between versions, so both are written:
 * `allowBuilds` is pnpm 11's, `onlyBuiltDependencies` is pnpm 10's. Verified against both
 * (11: exit 0 with either, 10: exit 0 with both, no complaint about the key it does not
 * know).
 *
 * The `pnpm` field in package.json is deliberately NOT used: pnpm 11 warns that it no longer
 * reads it.
 *
 * Written for every project rather than only for pnpm users. It is four lines, npm and yarn
 * ignore it, and the alternative is a project that breaks for whoever clones it with pnpm.
 */
function writePnpmSettings(targetDir: string): void {
  writeFileSync(
    join(targetDir, "pnpm-workspace.yaml"),
    `# esbuild needs its install script to put the platform binary in place. pnpm 11 reads
# \`allowBuilds\`, pnpm 10 reads \`onlyBuiltDependencies\`; both are here so either works.
allowBuilds:
  esbuild: true
onlyBuiltDependencies:
  - esbuild
`,
  );
}

/** A vitest config + one example test, dropped in when the Testing add-on is picked. */
function writeTestingFiles(targetDir: string, mode: Mode): void {
  writeFileSync(
    join(targetDir, "vitest.config.ts"),
    `import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsxFactory: "h",
    jsxInject: \`import { h } from '@ramonda/core'\`,
    target: "es2022",
  },
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
 * paths (dist, node_modules). The schema version tracks V.biome so the two never drift.
 */
function writeBiomeConfig(targetDir: string): void {
  const version = V.biome.replace(/^\D*/, "");
  const config = {
    $schema: `https://biomejs.dev/schemas/${version}/schema.json`,
    vcs: { enabled: true, clientKind: "git", useIgnoreFile: true },
    files: { ignoreUnknown: true },
    formatter: { enabled: true, indentStyle: "space", indentWidth: 2, lineWidth: 120 },
    linter: { enabled: true, rules: { preset: "recommended" } },
    javascript: { formatter: { quoteStyle: "double" } },
  };
  writeFileSync(join(targetDir, "biome.json"), JSON.stringify(config, null, 2) + "\n");
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
