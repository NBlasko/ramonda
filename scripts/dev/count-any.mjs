/**
 * Counts `any` in the published packages' own source — the number item 33 is measured by.
 *
 * ## Why a script rather than a grep
 *
 * A grep reads ~270 and means nothing: it counts the word inside comments that EXPLAIN why an `any`
 * is there, inside string literals, and inside `.d.ts` files nobody wrote. Each of those moves when
 * prose is edited, so the number would drift without a single type changing.
 *
 * So: every published package's `src`, minus tests, minus `.d.ts`; block and line comments stripped;
 * string, template and regex literals blanked; then `any` as a whole word.
 *
 * ## Why it lives here now
 *
 * The first two passes used a script in a scratch directory, and it is gone — which made 111 and 105
 * incomparable and cost a round of re-measuring. A number that has to be trusted needs a script
 * somebody can point at and re-run.
 *
 *   node scripts/dev/count-any.mjs           # the totals
 *   node scripts/dev/count-any.mjs --sites   # every line, to work from
 */
import { globSync, readFileSync } from "node:fs";

const published = globSync("{packages,apps}/*/package.json")
  .filter((f) => !JSON.parse(readFileSync(f, "utf8")).private)
  .map((f) => f.replace(/\/package\.json$/, ""));

/** Comments and literals out, so only code is counted. Length is preserved, so lines still line up. */
function codeOnly(source) {
  let out = "";
  let i = 0;
  const blank = (n) => " ".repeat(n);
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (two === "//") {
      let end = source.indexOf("\n", i);
      if (end === -1) end = source.length;
      out += blank(end - i);
      i = end;
      continue;
    }
    const q = source[i];
    if (q === '"' || q === "'" || q === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== q) {
        if (source[j] === "\\") j++;
        j++;
      }
      const stop = Math.min(j + 1, source.length);
      out += q + source.slice(i + 1, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    out += q;
    i++;
  }
  return out;
}

const sites = [];
let files = 0;
for (const pkg of published) {
  for (const file of globSync(`${pkg}/src/**/*.{ts,tsx}`)) {
    if (file.includes("__tests__") || file.endsWith(".d.ts") || /\.test\.tsx?$/.test(file)) continue;
    files++;
    const lines = codeOnly(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, n) => {
      // The MATCH is not read — one push per occurrence is the whole count.
      for (const _match of line.matchAll(/\bany\b/g)) {
        sites.push({ file, line: n + 1, text: line.trim(), cast: /\bas any\b/.test(line) });
      }
    });
  }
}

if (process.argv.includes("--sites")) {
  for (const s of sites) console.log(`${s.file}:${s.line}  ${s.text.slice(0, 120)}`);
}
const byPkg = new Map();
for (const s of sites) {
  const pkg = s.file.split("/").slice(0, 2).join("/");
  byPkg.set(pkg, (byPkg.get(pkg) ?? 0) + 1);
}
for (const [pkg, n] of [...byPkg].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${pkg}`);
console.log(`\n${sites.length} \`any\`, ${sites.filter((s) => s.cast).length} of them \`as any\`, over ${files} files`);
