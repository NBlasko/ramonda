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
// `@ramonda/*` are skipped on purpose: they are first-party and published in the
// same monorepo release, so a pre-publish check would race against their own
// publish. The concern here is external packages, which are already on the
// registry by the time we pin them.
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
    scaffold({ targetDir: dir, name: "verify", mode, addons: ["router", "lens", "testing", "devtools", "biome"] });
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

console.log(`Verifying ${names.length} third-party dependency ranges on the npm registry…\n`);

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
