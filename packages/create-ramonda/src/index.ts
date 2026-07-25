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

// Version specifiers written into the generated package.json. Kept together so a
// release only has to touch this block.
//
// `@ramonda/*` use `~0.0.1`, NOT `^0.0.1`: on a `0.0.z` version the caret pins to
// that exact patch (`^0.0.1` === only 0.0.1), so a scaffold would never pick up
// 0.0.2 — including whatever new API a freshly-published template already uses.
// The tilde is `>=0.0.1 <0.1.0`, so a scaffold gets the latest 0.0.x, and the
// scaffolder itself still gates the 0.1 / 1.0 line by bumping this when it adopts one.
const V = {
  ramonda: "~0.0.1",
  vite: "^7.3.6",
  typescript: "^5.9.3",
  typesNode: "^26.1.1",
  vitest: "^3.2.4",
  jsdom: "^28.0.0",
  esbuild: "^0.28.1",
  biome: "^2.5.5",
};

type Mode = "spa" | "ssr";
type AddOn = "router" | "lens" | "testing" | "devtools" | "biome";

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
    const res = spawnSync(pm, ["install"], { cwd: targetDir, stdio: "ignore" });
    if (res.status === 0) inst.stop("Installed dependencies");
    else inst.stop(pc.yellow(`\`${pm} install\` failed — run it yourself in the project.`));
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
  deps.dependencies["@ramonda/core"] = V.ramonda;

  if (addons.includes("router")) deps.dependencies["@ramonda/router"] = V.ramonda;
  if (addons.includes("lens")) deps.dependencies["@ramonda/lens"] = V.ramonda;
  if (addons.includes("devtools")) deps.devDependencies["@ramonda/devtools"] = V.ramonda;

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
    deps.devDependencies["@ramonda/testing-library"] = V.ramonda;
    if (mode === "spa") deps.devDependencies["jsdom"] = V.jsdom;
    writeTestingFiles(targetDir, mode);
  }

  if (addons.includes("biome")) {
    deps.devDependencies["@biomejs/biome"] = V.biome;
    writeBiomeConfig(targetDir);
  }

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
