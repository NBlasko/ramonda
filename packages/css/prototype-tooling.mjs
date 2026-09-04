/**
 * The formatter and the linter cannot read a file containing `@( … )`. What can be done about it?
 *
 * The first answer people reach for is a suppression comment, and it cannot work: `biome-ignore` and
 * `oxlint-disable` are read BY the parser, and the parser fails before it reaches them. Measured —
 * biome answers "Code formatting aborted due to parsing errors" with the comments in place.
 *
 * This is also what makes the comparison with CSS-in-a-backtick misleading. Those work because a
 * tagged template is ALREADY valid TypeScript: the tool parses the file, sees a string, and looks no
 * further. Nothing had to be taught. Here the file does not parse, so there is no region to ignore —
 * there is no region at all.
 *
 * Both halves have an answer, and they are different answers.
 *
 *   - **The linter**: run it on the virtual file and map the diagnostics back, exactly as with `tsc`.
 *     `oxlint --format=json` reports offset, line and column, which is all a map needs.
 *   - **The formatter**: a position map is not enough, because a formatter rewrites text rather than
 *     reporting positions in it. So the block is replaced by a PLACEHOLDER that parses, the file is
 *     formatted normally, and the block is put back at the placeholder's indentation.
 *
 *     node packages/css/prototype-tooling.mjs
 */
import { execFileSync } from "node:child_process";
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = process.cwd();
const require = createRequire(import.meta.url);
const store = (name) =>
  join(repo, globSync(`node_modules/.pnpm/${name.replaceAll("/", "+")}@*/node_modules/${name}`, { cwd: repo })[0]);
const MagicString = require(store("magic-string")).default;
const { TraceMap, originalPositionFor } = require(store("@jridgewell/trace-mapping"));
const oxlint = join(repo, globSync("node_modules/.pnpm/oxlint@*/node_modules/oxlint/bin/oxlint", { cwd: repo })[0]);
const biome = join(
  repo,
  globSync("node_modules/.pnpm/@biomejs+biome@*/node_modules/@biomejs/biome/bin/biome", { cwd: repo })[0],
);

const FILE = "Card.tsx";
const source = `export const Card = (props: { id: string }) => {
  const accent = "#10b981";
  return (
    <div css=@(
      display: flex;
      border-left: {{accent}};
    )>
      <span>{props.id}</span>
    </div>
  );
};

const   neverUsed   =    41;

export function afterTheBlock() {
  debugger;
}
`;

/** Find every block: the span to replace, and the expressions inside it. */
function blocksIn(text) {
  const found = [];
  let cursor = 0;
  for (;;) {
    const at = text.indexOf("css=@(", cursor);
    if (at === -1) return found;
    let scan = at + 6;
    let depth = 1;
    const holes = [];
    while (scan < text.length && depth > 0) {
      if (text.startsWith("{{", scan)) {
        const end = text.indexOf("}}", scan + 2);
        holes.push({ start: scan + 2, end });
        scan = end + 2;
        continue;
      }
      if (text[scan] === "(") depth++;
      else if (text[scan] === ")") {
        depth--;
        if (depth === 0) break;
      }
      scan++;
    }
    found.push({ start: at, end: scan + 1, holes });
    cursor = scan + 1;
  }
}

const dir = mkdtempSync(join(tmpdir(), "css-tooling-"));

// ---- 1. the linter: run on the virtual file, map back ------------------------------------------

const magic = new MagicString(source);
blocksIn(source).forEach((block, index) => {
  // Only the CSS between the expressions is replaced — see prototype-sourcemap.mjs for why.
  if (block.holes.length === 0) magic.overwrite(block.start, block.end, `css={_s${index}}`);
  else {
    magic.overwrite(
      block.start,
      block.holes[0].start,
      `css={_s${index}}` === "" ? "" : `css={_s${index}}`.slice(0, -1) + "(",
    );
    for (let n = 0; n < block.holes.length - 1; n++)
      magic.overwrite(block.holes[n].end, block.holes[n + 1].start, ", ");
    magic.overwrite(block.holes[block.holes.length - 1].end, block.end, ")}");
  }
});
magic.prepend("declare const _s0: (v: string) => string;\n");

const virtual = magic.toString();
const map = new TraceMap({ ...magic.generateMap({ source: FILE, includeContent: true, hires: true }), version: 3 });

writeFileSync(join(dir, "virtual.tsx"), virtual);
// A config of its own, so the run does not depend on whatever the surrounding project enables.
writeFileSync(
  join(dir, ".oxlintrc.json"),
  JSON.stringify({ rules: { "no-unused-vars": "error", "no-debugger": "error" } }),
);
let report = { diagnostics: [] };
try {
  execFileSync(oxlint, ["--format=json", "virtual.tsx"], { cwd: dir, encoding: "utf8" });
} catch (error) {
  report = JSON.parse(`${error.stdout}`.slice(`${error.stdout}`.indexOf("{")));
}

console.log("THE LINTER — run on the virtual file, mapped back to the author's:\n");
if (report.diagnostics.length === 0) console.log("  (nothing reported)");
for (const diagnostic of report.diagnostics) {
  const label = diagnostic.labels?.[0]?.span;
  const home = label === undefined ? null : originalPositionFor(map, { line: label.line, column: label.column - 1 });
  const line = home?.line ?? null;
  console.log(`  ${FILE}:${line ?? "?"}:${(home?.column ?? 0) + 1}  ${diagnostic.message}`);
  if (line !== null) console.log(`      ${source.split("\n")[line - 1].trim()}`);
}

// ---- 2. the formatter: placeholder in, format, block back --------------------------------------

const blocks = blocksIn(source);
let placeheld = "";
let cursor = 0;
const kept = [];
blocks.forEach((block, index) => {
  placeheld += source.slice(cursor, block.start);
  kept.push(source.slice(block.start, block.end));
  placeheld += `css={/*@css${index}*/ 0}`;
  cursor = block.end;
});
placeheld += source.slice(cursor);

writeFileSync(join(dir, "placeheld.tsx"), placeheld);
try {
  execFileSync(biome, ["format", "--write", "placeheld.tsx"], { cwd: dir, encoding: "utf8", stdio: "ignore" });
} catch {
  /* biome exits non-zero when it rewrites; the file is what matters */
}
let formatted = readFileSync(join(dir, "placeheld.tsx"), "utf8");

kept.forEach((block, index) => {
  const marker = `css={/*@css${index}*/ 0}`;
  const at = formatted.indexOf(marker);
  const lineStart = formatted.lastIndexOf("\n", at) + 1;
  // Copy the formatter's own indentation rather than counting columns — it may have chosen tabs.
  const outer = /^\s*/.exec(formatted.slice(lineStart, at))[0];
  const inner = outer + (outer.includes("\t") ? "\t" : "  ");
  const lines = block.split("\n");
  const relaid = lines
    .map((line, n) => (n === 0 ? line : n === lines.length - 1 ? outer + line.trim() : inner + line.trim()))
    .join("\n");
  formatted = formatted.replace(marker, relaid);
});

rmSync(dir, { recursive: true, force: true });

console.log("\n\nTHE FORMATTER — placeholder in, format, block back:\n");
console.log(
  formatted
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n"),
);
