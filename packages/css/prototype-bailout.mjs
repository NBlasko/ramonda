/**
 * The dev-mode cost of a file that does NOT use the feature, measured rather than promised.
 *
 * This is the number the whole "fast in dev" claim rests on: a file with no sigil is never parsed,
 * so the overwhelming majority of a codebase pays a substring scan and nothing else.
 *
 *     node packages/css/prototype-bailout.mjs
 */
import { globSync, readFileSync } from "node:fs";
const files = globSync("{apps,packages}/*/src/**/*.{ts,tsx}", { cwd: process.cwd() }).filter(
  (f) => !f.includes("/dist/") && !f.includes("/.build/"),
);
const sources = files.map((f) => readFileSync(f, "utf8"));
const bytes = sources.reduce((n, s) => n + s.length, 0);

// the bail-out: a file with no sigil is never parsed
let hits = 0;
const t0 = performance.now();
for (let round = 0; round < 20; round++) {
  hits = 0;
  for (const s of sources) if (s.includes("=@(")) hits++;
}
const t1 = performance.now();

console.log(`files            ${files.length}`);
console.log(`bytes            ${(bytes / 1e6).toFixed(2)} MB`);
console.log(`files with a block ${hits}`);
console.log(
  `scan, whole tree ${((t1 - t0) / 20).toFixed(2)} ms   (${(bytes / 1e6 / ((t1 - t0) / 20 / 1000)).toFixed(0)} MB/s)`,
);
console.log(`per file         ${(((t1 - t0) / 20 / files.length) * 1000).toFixed(1)} µs`);
