/**
 * Do the source maps COMPOSE? — one of the two things the audit listed as unexamined.
 *
 * Our transform runs before esbuild, so there are two maps between the browser and the author:
 * ours (author's file → transformed file) and esbuild's (transformed file → emitted JavaScript).
 * A stack trace is only useful if walking both lands back on the line the author wrote.
 *
 * The risky part is not the block itself — it is everything AFTER it. The transform deletes a lot
 * of text (the CSS) and inserts a little (the call), so every position downstream of a block moves.
 * A map that is right at the block and drifts below it would look correct in a first test.
 *
 *     node packages/css/prototype-sourcemap.mjs
 */
import { createRequire } from "node:module";
import { globSync } from "node:fs";

const require = createRequire(import.meta.url);
const store = (name) =>
  globSync(`node_modules/.pnpm/${name.replaceAll("/", "+")}@*/node_modules/${name}`, { cwd: process.cwd() })[0];
const MagicString = require(`${process.cwd()}/${store("magic-string")}`).default;
const { TraceMap, originalPositionFor } = require(
  `${process.cwd()}/${store("@jridgewell/trace-mapping")}`,
);
const { transformSync } = require(`${process.cwd()}/${store("esbuild")}`);

const FILE = "Card.tsx";
const source = `import { Component } from "@ramonda/core";

export class Card extends Component<{ id: string }> {
  accent = "#10b981";

  render() {
    return (
      <div css=@(
        display: flex;
        flex-direction: column;
        padding: 24px;
        background-color: #0f172a;
        border-left: {{this.accent}};
      )>
        <span>{this.id}</span>
      </div>
    );
  }

  afterTheBlock() {
    return this.accent.toUpperCase();
  }
}
`;

// ---- our transform, with a map ----------------------------------------------------------------

const magic = new MagicString(source);
const hoisted = [];
let cursor = 0;
for (;;) {
  const at = source.indexOf("css=@(", cursor);
  if (at === -1) break;
  let scan = at + 6;
  let depth = 1;
  const holes = [];
  while (scan < source.length && depth > 0) {
    if (source.startsWith("{{", scan)) {
      const end = source.indexOf("}}", scan + 2);
      holes.push({ start: scan + 2, end });
      scan = end + 2;
      continue;
    }
    if (source[scan] === "(") depth++;
    else if (source[scan] === ")") {
      depth--;
      if (depth === 0) break;
    }
    scan++;
  }
  const id = `_s${hoisted.length}`;
  hoisted.push(`const ${id} = block("r-0123456789abcdef");`);

  /**
   * Replace only the CSS BETWEEN the expressions, never the expressions themselves.
   *
   * Overwriting the whole block in one span is the obvious thing and it costs the mapping: every
   * expression then points at the block's opening line instead of its own. Leaving each
   * expression's bytes exactly where the author put them is what makes the map exact, and it costs
   * nothing but writing the gaps out one at a time.
   */
  if (holes.length === 0) {
    magic.overwrite(at, scan + 1, `css={${id}}`);
  } else {
    magic.overwrite(at, holes[0].start, `css={${id}(`);
    for (let n = 0; n < holes.length - 1; n++) magic.overwrite(holes[n].end, holes[n + 1].start, ", ");
    magic.overwrite(holes[holes.length - 1].end, scan + 1, ")}");
  }
  cursor = scan + 1;
}
magic.prepend(`${hoisted.join("\n")}\n`);

const intermediate = magic.toString();
const ourMap = magic.generateMap({ source: FILE, includeContent: true, hires: true });

// ---- esbuild, with its own map -----------------------------------------------------------------

const emitted = transformSync(intermediate, {
  loader: "tsx",
  jsx: "automatic",
  jsxImportSource: "@ramonda/core",
  target: "es2022",
  sourcemap: true,
  sourcefile: "Card.intermediate.tsx",
});

// ---- compose: emitted -> intermediate -> author -------------------------------------------------

const theirs = new TraceMap(JSON.parse(emitted.map));
const ours = new TraceMap({ ...ourMap, version: 3 });

/** Walk both maps for one position in the emitted JavaScript. */
function backToAuthor(line, column) {
  const mid = originalPositionFor(theirs, { line, column });
  if (mid.line === null) return null;
  const top = originalPositionFor(ours, { line: mid.line, column: mid.column });
  return top.line === null ? null : top;
}

/** Find a position in the emitted JS for a piece of text, then walk it home. */
function check(label, needle, expectLine) {
  const lines = emitted.code.split("\n");
  const line = lines.findIndex((text) => text.includes(needle));
  if (line === -1) return console.log(`${label.padEnd(30)} NOT FOUND in the emitted code`);
  const column = lines[line].indexOf(needle);
  const home = backToAuthor(line + 1, column);
  const authorLine = source.split("\n")[expectLine - 1]?.trim() ?? "";
  const ok = home !== null && home.line === expectLine;
  console.log(
    `${label.padEnd(30)} ${ok ? "OK  " : "WRONG"}  -> ${home === null ? "nothing" : `${FILE}:${home.line}:${home.column}`}   expected line ${expectLine}   ${ok ? "" : `(author line ${expectLine}: ${authorLine})`}`,
  );
  return ok;
}

console.log(
  `author ${source.split("\n").length} lines -> intermediate ${intermediate.split("\n").length} -> emitted ${emitted.code.split("\n").length}\n`,
);

const results = [
  check("the class declaration", "class Card", 3),
  check("the field above the block", '"#10b981"', 4),
  check("the hole's expression", "this.accent", 13),
  check("a method BELOW the block", "afterTheBlock", 20),
  check("code below that", "toUpperCase", 21),
];

console.log(`\n${results.filter(Boolean).length} of ${results.length} positions land on the author's own line.`);
