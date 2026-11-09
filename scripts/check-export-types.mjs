/**
 * Every entry a published package exports carries its types.
 *
 *     node scripts/check-export-types.mjs
 *     SELFTEST=missing node scripts/check-export-types.mjs   # must fail
 *
 * ## The fault this exists for
 *
 * `@ramonda/testing-library` exported `./dont-cleanup-after-each` and `./dont-fail-on-diagnostics`
 * with an `import` and no `types`. The `.d.ts` files were built; nothing pointed at them. Since
 * TypeScript 6 checks a side-effect import too, `import "@ramonda/testing-library/dont-cleanup-after-each"`
 * — the line the docs tell a setup file to write — failed a reader's type check with TS2882. Found by
 * the docs' own examples check, the first time a page showed that line.
 *
 * An entry is typed when its conditions name `types`, or when every condition below it does — the
 * shape `@ramonda/css/config` has, with `import` and `require` each carrying their own.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Whether one export target is typed. A string that is not code (a `.css`, a `.json`) needs none. */
function typed(target) {
  if (typeof target === "string") return !/\.(m?js|cjs)$/.test(target);
  if (target === null || typeof target !== "object") return true;
  if ("types" in target) return true;
  // `default` is the fallback for a resolver that matched nothing else, and TypeScript always matches
  // `import` or `require` first — so beside typed siblings, an untyped `default` is never what it reads.
  const conditions = Object.entries(target).filter(([condition]) => condition !== "default");
  return conditions.length > 0 && conditions.every(([, inner]) => typed(inner));
}

function untypedIn(pkg) {
  const exports = pkg.exports;
  if (exports === undefined) return [];
  if (typeof exports === "string") return typed(exports) ? [] : ["."];
  const subpaths = Object.keys(exports).some((key) => key.startsWith(".")) ? exports : { ".": exports };
  return Object.entries(subpaths)
    .filter(([, target]) => !typed(target))
    .map(([subpath]) => subpath);
}

const packages = readdirSync(join(root, "packages"))
  .map((dir) => join(root, "packages", dir, "package.json"))
  .filter((file) => existsSync(file))
  .map((file) => JSON.parse(readFileSync(file, "utf8")))
  .filter((pkg) => !pkg.private);

if (process.env.SELFTEST === "missing") {
  packages.push({
    name: "@ramonda/planted",
    exports: { ".": { types: "./a.d.ts", import: "./a.js" }, "./b": { import: "./b.js" } },
  });
}

const untyped = packages.flatMap((pkg) => untypedIn(pkg).map((subpath) => `${pkg.name} ${subpath}`));

if (untyped.length > 0) {
  console.error(`[export-types] ${untyped.length} export(s) with no types:\n`);
  for (const one of untyped) console.error(`  ${one}`);
  console.error(
    "\nA TypeScript reader importing one gets TS7016, or TS2882 for a side-effect import. Point a `types`\n" +
      "condition at the built `.d.ts`, first in the entry.",
  );
  if (process.env.SELFTEST === "missing") {
    console.log("[export-types] SELFTEST missing: the planted export was reported, as it must be");
    process.exit(untyped.length === 1 && untyped[0] === "@ramonda/planted ./b" ? 0 : 1);
  }
  process.exit(1);
}

if (process.env.SELFTEST === "missing") {
  console.error("[export-types] SELFTEST missing: the planted export was NOT reported");
  process.exit(1);
}
console.log(`[export-types] every export of ${packages.length} package(s) carries its types`);
