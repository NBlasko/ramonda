import { readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

/**
 * Every package and app inherits one tsconfig, and none of them re-states what it says.
 *
 * ## The fault it exists for, and it was not the duplication
 *
 * Seventeen configs wrote out the same options and **none used `extends`**, so a change to any of them
 * was a seventeen-file edit. That is the tidiness argument, and it is the smaller one.
 *
 * The measurement was the real finding: only FOUR options were identical across all seventeen
 * (`module`, `moduleResolution`, `skipLibCheck`, `strict`). Everything else drifted, and the drift was
 * not a set of decisions — it was silence. **Thirteen of the seventeen got none of
 * `noUnusedParameters`, `noImplicitOverride` or `noFallthroughCasesInSwitch`**, while `core`,
 * `dom-facts` and `theme` got all of them and `devtools` got two. Nobody chose that; the blocks were
 * copied at different times.
 *
 * Turning those three on for everyone cost **two errors across fourteen projects**, and both were real:
 * an unused parameter in `duplicate-key-among-siblings`, and — in the demo that TEACHES inheritance —
 * a method overriding its base without `override` (`TS4114`).
 *
 * ## Why `noUnusedLocals` is deliberately not in the base
 *
 * Measured: **103 errors**, and they are not dead code. Nearly all are `const provider = …` in tests —
 * a value built for its side effect and deliberately never read. Turning it on repo-wide would fight
 * a test idiom rather than find a bug, so the three packages that want it keep it themselves.
 *
 * ## What this checks
 *
 * That every config extends the base, and that none re-declares an option the base already sets — the
 * second being how the duplication comes back one package at a time. It does NOT police the options a
 * project sets for itself: `target`, `jsx`, `types`, `paths`, `lib` and `include` are genuinely
 * per-project, and `paths`/`include` **must** stay in the child because a relative path resolves
 * against the config that declares it.
 */

const root = join(import.meta.dirname, "..");
const BASE = "tsconfig.base.json";

/** What the base sets, read from the base rather than repeated here — one list, not two. */
const shared = Object.keys(ts.readConfigFile(resolve(root, BASE), ts.sys.readFile).config?.compilerOptions ?? {});

if (shared.length === 0) {
  console.error(`[tsconfigs] ${BASE} declares no compilerOptions — nothing could be inheriting anything.`);
  process.exit(1);
}

const projects = [];
for (const group of ["packages", "apps"]) {
  for (const name of readdirSync(join(root, group))) {
    const file = join(group, name, "tsconfig.json");
    if (existsSync(join(root, file))) projects.push(file);
  }
}

const faults = [];
for (const file of projects) {
  const full = resolve(root, file);
  const own = ts.readConfigFile(full, ts.sys.readFile).config ?? {};
  const expected = `${relative(dirname(full), root).split(sep).join("/")}/${BASE}`;

  if (own.extends !== expected) {
    faults.push(`${file}\n    extends ${JSON.stringify(own.extends ?? null)}, expected "${expected}"`);
    continue;
  }

  const repeated = shared.filter((option) => own.compilerOptions?.[option] !== undefined);
  if (repeated.length > 0) {
    faults.push(
      `${file}\n    re-declares ${repeated.join(", ")} — the base already sets ${repeated.length === 1 ? "it" : "them"}`,
    );
  }

  // The inheritance has to ARRIVE, not merely be declared: `extends` is resolved by TypeScript, and a
  // typo in the path is not an error, it is a config that quietly sets nothing.
  const resolvedOptions = ts.parseJsonConfigFileContent(own, ts.sys, dirname(full), undefined, full).options;
  const missing = shared.filter((option) => resolvedOptions[option] === undefined);
  if (missing.length > 0) faults.push(`${file}\n    ${missing.join(", ")} did not arrive from the base`);
}

if (faults.length > 0) {
  console.error(`\n[tsconfigs] ${faults.length} config(s) not inheriting cleanly:\n`);
  for (const fault of faults) console.error(`  ${fault}\n`);
  console.error(`Every package and app extends ${BASE}; what it sets belongs there, not in the child.\n`);
  process.exit(1);
}

console.log(
  `[tsconfigs] ${projects.length} projects extend ${BASE}, and all ${shared.length} shared options arrive in every one`,
);
