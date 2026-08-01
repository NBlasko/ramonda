import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Collects every package's lcov report into one `coverage/lcov.info` for the repository.
 *
 * Two problems make this more than a `cat`:
 *
 * 1. **Paths collide.** vitest writes source paths relative to the package it ran in, so six
 *    packages produce six `SF:src/index.ts` records for six different files. Coveralls would
 *    show one file with whichever numbers landed last. Each record is therefore rewritten to
 *    `packages/<name>/src/…`, which is also what makes a Coveralls line link back to the right
 *    file on GitHub.
 *
 * 2. **Some code only runs in production.** core, query and lens each have a second test run
 *    under NODE_ENV=production, because `__DEV__` is baked in per process — the loop stops and
 *    the stripped diagnostics can only be reached there. Read separately, each run reports the
 *    other's code as dead. Measured on @ramonda/lens: the development run hits 169 of 197 lines
 *    and the production run 89, but 4 of the production run's lines are ones development never
 *    reaches — 85.79% alone against 87.82% merged. So records for the same file are UNIONED:
 *    per-line and per-branch hit counts are summed, and the LH/FNH/BRH totals recomputed from
 *    the merged data rather than trusted from either input.
 *
 * `SELFTEST=1` runs it against two synthetic reports whose answer is worked out by hand, because
 * a merge that has only ever seen real input has not been shown to merge anything.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** One parsed lcov record: a file, and what the run observed in it. */
function parse(text) {
  const records = new Map();
  let current = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      const file = line.slice(3);
      current = records.get(file);
      if (!current) {
        current = { file, lines: new Map(), functions: new Map(), branches: new Map(), names: new Map() };
        records.set(file, current);
      }
    } else if (!current) {
      continue;
    } else if (line.startsWith("DA:")) {
      const [n, count] = line.slice(3).split(",");
      current.lines.set(Number(n), (current.lines.get(Number(n)) ?? 0) + Number(count));
    } else if (line.startsWith("FN:")) {
      // FN:<line>,<name> — the declaration. Kept apart from FNDA (the call count) so a
      // function declared but never called still counts against the total.
      const at = line.indexOf(",");
      current.names.set(line.slice(at + 1), Number(line.slice(3, at)));
      if (!current.functions.has(line.slice(at + 1))) current.functions.set(line.slice(at + 1), 0);
    } else if (line.startsWith("FNDA:")) {
      const at = line.indexOf(",");
      const name = line.slice(at + 1);
      current.functions.set(name, (current.functions.get(name) ?? 0) + Number(line.slice(5, at)));
    } else if (line.startsWith("BRDA:")) {
      // BRDA:<line>,<block>,<branch>,<count|-> — "-" means the branch was never evaluated.
      const [ln, block, branch, count] = line.slice(5).split(",");
      const key = `${ln},${block},${branch}`;
      const taken = count === "-" ? 0 : Number(count);
      current.branches.set(key, (current.branches.get(key) ?? 0) + taken);
    }
  }
  return records;
}

/** Merge `incoming` into `into`, summing every count. */
function merge(into, incoming) {
  for (const [file, rec] of incoming) {
    const target = into.get(file);
    if (!target) {
      into.set(file, rec);
      continue;
    }
    for (const [n, c] of rec.lines) target.lines.set(n, (target.lines.get(n) ?? 0) + c);
    for (const [n, c] of rec.functions) target.functions.set(n, (target.functions.get(n) ?? 0) + c);
    for (const [n, c] of rec.branches) target.branches.set(n, (target.branches.get(n) ?? 0) + c);
    for (const [n, l] of rec.names) target.names.set(n, l);
  }
  return into;
}

/** Serialize back to lcov, with every total recomputed from the merged counts. */
function format(records) {
  const out = [];
  for (const rec of [...records.values()].sort((a, b) => a.file.localeCompare(b.file))) {
    out.push("TN:", `SF:${rec.file}`);

    for (const [name, line] of rec.names) out.push(`FN:${line},${name}`);
    for (const [name, count] of rec.functions) out.push(`FNDA:${count},${name}`);
    out.push(`FNF:${rec.functions.size}`, `FNH:${[...rec.functions.values()].filter((c) => c > 0).length}`);

    for (const [key, count] of rec.branches) out.push(`BRDA:${key},${count === 0 ? "-" : count}`);
    out.push(`BRF:${rec.branches.size}`, `BRH:${[...rec.branches.values()].filter((c) => c > 0).length}`);

    for (const [n, count] of [...rec.lines].sort((a, b) => a[0] - b[0])) out.push(`DA:${n},${count}`);
    out.push(`LF:${rec.lines.size}`, `LH:${[...rec.lines.values()].filter((c) => c > 0).length}`);

    out.push("end_of_record");
  }
  return `${out.join("\n")}\n`;
}

/** Rewrite `src/x.ts` to `packages/<pkg>/src/x.ts`. */
function prefix(records, pkg) {
  const out = new Map();
  for (const [file, rec] of records) {
    const full = `packages/${pkg}/${file}`;
    out.set(full, { ...rec, file: full });
  }
  return out;
}

function summarize(records) {
  let lf = 0;
  let lh = 0;
  for (const rec of records.values()) {
    lf += rec.lines.size;
    lh += [...rec.lines.values()].filter((c) => c > 0).length;
  }
  return { lf, lh, pct: lf === 0 ? 0 : (lh / lf) * 100 };
}

if (process.env.SELFTEST === "1") {
  // Two runs over one file. Line 1 is hit by both, line 2 only by the first, line 3 only by the
  // second, line 4 by neither. A merge that works reports 3 of 4 lines; one that simply takes the
  // last report seen reports 2, which is the bug this exists to prevent.
  const a = ["TN:", "SF:src/a.ts", "DA:1,5", "DA:2,1", "DA:3,0", "DA:4,0", "LF:4", "LH:2", "end_of_record"].join("\n");
  const b = ["TN:", "SF:src/a.ts", "DA:1,2", "DA:2,0", "DA:3,7", "DA:4,0", "LF:4", "LH:2", "end_of_record"].join("\n");

  const merged = merge(parse(a), parse(b));
  const { lf, lh } = summarize(merged);
  if (lf !== 4 || lh !== 3) {
    console.error(`[coverage] SELFTEST failed: expected 3 of 4 lines hit after merging, got ${lh} of ${lf}.`);
    process.exit(1);
  }
  const text = format(merged);
  if (!text.includes("DA:1,7")) {
    console.error("[coverage] SELFTEST failed: hit counts were not summed (expected DA:1,7 from 5+2).");
    process.exit(1);
  }
  if (!format(prefix(merged, "lens")).includes("SF:packages/lens/src/a.ts")) {
    console.error("[coverage] SELFTEST failed: paths were not rewritten to be repository-relative.");
    process.exit(1);
  }
  // And the reverse: a file only one report knows about must survive the merge.
  const solo = merge(parse(a), parse(["TN:", "SF:src/b.ts", "DA:1,1", "LF:1", "LH:1", "end_of_record"].join("\n")));
  if (solo.size !== 2) {
    console.error(`[coverage] SELFTEST failed: a file present in only one report was dropped (${solo.size} files).`);
    process.exit(1);
  }
  console.log("[coverage] SELFTEST passed: reports union rather than overwrite, counts sum, paths are rewritten.");
  process.exit(0);
}

const packages = join(root, "packages");
const combined = new Map();
const found = [];

for (const pkg of readdirSync(packages)) {
  // Both directories a package can write: `coverage/` from the development run, and
  // `coverage-prod/` from the production one where it exists.
  for (const dir of ["coverage", "coverage-prod"]) {
    const file = join(packages, pkg, dir, "lcov.info");
    if (!existsSync(file)) continue;
    const records = prefix(parse(readFileSync(file, "utf8")), pkg);
    found.push({ pkg, dir, files: records.size, ...summarize(records) });
    merge(combined, records);
  }
}

if (found.length === 0) {
  console.error(
    "\n[coverage] No lcov reports found under packages/*/coverage/.\n" +
      "[coverage] Run `pnpm exec turbo run coverage` first — this script only combines what that produces.\n",
  );
  process.exit(1);
}

const out = join(root, "coverage");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "lcov.info"), format(combined));

for (const r of found) {
  console.log(
    `[coverage] ${`${r.pkg}/${r.dir}`.padEnd(34)} ${String(r.files).padStart(3)} files  ${r.pct.toFixed(2)}%`,
  );
}
const total = summarize(combined);
console.log(
  `[coverage] ${"combined".padEnd(34)} ${String(combined.size).padStart(3)} files  ` +
    `${total.pct.toFixed(2)}%  (${total.lh}/${total.lf} lines) → coverage/lcov.info`,
);
