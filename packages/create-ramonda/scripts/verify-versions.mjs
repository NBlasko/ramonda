// Pre-publish gate: prove that every third-party version range the scaffolder
// writes into a project actually resolves on the npm registry.
//
// Why this exists: `src/index.ts` pins dependency RANGES (vite, vitest, biome,
// esbuild, jsdom, typescript, @types/node…). If one of those is bumped to a
// version that was never published, the CLI still builds and publishes fine — but
// every user's first `npm install` then 404s. This script fails the release
// instead, before the broken CLI ever ships.
//
// It checks the REAL output of `scaffold()` (not a parallel copy of the version
// map), scaffolding with every add-on in both modes so each dependency the CLI
// can emit shows up. New dependencies are covered automatically.
//
// `@ramonda/*` are not checked against the REGISTRY, on purpose: they are first-party and
// published in the same release, so a registry check would race against their own publish.
// They are checked against the WORKSPACE instead — the versions on disk are the ones about
// to be published, so a range that does not match them is a range that will 404 for every
// user. That hole shipped once: the scaffolder pinned `~0.0.1` while core and query went out
// at 0.1.0, and a fresh project's first install failed on a version that does not exist.
//
// Needs a prior build — it imports the built `dist/index.js`. `pnpm release` runs
// `pnpm build` first, so in the release flow dist is always present.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = fileURLToPath(new URL(".", import.meta.url));
const distEntry = join(here, "..", "dist", "index.js");

let scaffold;
try {
  ({ scaffold } = await import(distEntry));
} catch (err) {
  console.error(`Could not import ${distEntry}. Run \`pnpm build\` first.`);
  console.error(String(err));
  process.exit(1);
}

/** Emit a project for one mode with every add-on, and return its dep map. */
function depsFor(mode) {
  const dir = mkdtempSync(join(tmpdir(), `ramonda-verify-${mode}-`));
  try {
    // EVERY add-on, which is the point: a package the scaffolder can emit but this list omits
    // is a package whose range nothing verifies. `query` was missing here — the one package
    // whose stale range is the reason this gate exists.
    const addons = ["router", "query", "form", "lens", "testing", "devtools", "biome"];
    scaffold({ targetDir: dir, name: "verify", mode, addons });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Union across both modes: vite is SPA-only, esbuild/jsdom are SSR-only.
const deps = { ...depsFor("spa"), ...depsFor("ssr") };

const names = Object.keys(deps)
  .filter((name) => !name.startsWith("@ramonda/"))
  .sort();

// First party, against the workspace.
const workspaceDir = join(here, "..", "..");
let firstPartyBad = 0;

for (const name of Object.keys(deps)
  .filter((n) => n.startsWith("@ramonda/"))
  .sort()) {
  const range = deps[name];
  const folder = name.replace("@ramonda/", "");
  let version = "";
  try {
    version = JSON.parse(readFileSync(join(workspaceDir, folder, "package.json"), "utf8")).version;
  } catch {
    console.error(`  ✗ ${name} — no such package in the workspace (the scaffolder writes ${range})`);
    firstPartyBad++;
    continue;
  }

  // `^0.1.0` must accept `0.1.0`. Comparing the range's own version to the package's is
  // enough here because the scaffolder writes one derived range for all of them: if core's
  // version produced the range, every package published in the same release shares it.
  const wanted = range.replace(/^[\^~]/, "");
  if (wanted !== version) {
    console.error(`  ✗ ${name} — the scaffolder writes ${range}, but the workspace is at ${version}`);
    firstPartyBad++;
  } else {
    console.log(`  ✓ ${name}  ${range} → workspace ${version}`);
  }
}

if (firstPartyBad > 0) {
  console.error(
    `\n${firstPartyBad} first-party range(s) do not match the workspace. The scaffolder would pin versions ` +
      `that are not being published — see tsup.config.ts, which derives the range from core's version.`,
  );
  process.exit(1);
}

console.log(`\nVerifying ${names.length} third-party dependency ranges on the npm registry…\n`);

let bad = 0;
for (const name of names) {
  const range = deps[name];
  let resolved = "";
  try {
    resolved = execFileSync("npm", ["view", `${name}@${range}`, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // npm exits non-zero when nothing satisfies the range.
  }
  if (resolved) {
    // npm prints a bare version for a single match, but `name@x.y.z 'x.y.z'` per
    // line when a range matches several — pull the clean version out of either.
    const last = resolved.split("\n").pop();
    const quoted = last.match(/'([^']+)'\s*$/);
    console.log(`  ✓ ${name}@${range} → ${quoted ? quoted[1] : last}`);
  } else {
    console.error(`  ✗ ${name}@${range} — no published version satisfies this range`);
    bad++;
  }
}

if (bad > 0) {
  console.error(`\n${bad} dependency range(s) do not resolve. Aborting the release.`);
  process.exit(1);
}
console.log(`\nAll ${names.length} dependency ranges resolve. Safe to publish.`);
