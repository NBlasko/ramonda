/**
 * The claim this package rests on, made runnable: **a syntax TypeScript cannot parse can still be
 * fully type-checked**, as long as we own the step that turns it into TypeScript.
 *
 * That is how the established file-format frameworks do it, and it is what `vue-tsc` and
 * `svelte-check` are. The shape is always the same three moves:
 *
 *   1. transform the author's file into a VIRTUAL file that is valid TSX, remembering where every
 *      carried-over expression landed;
 *   2. hand the virtual file to `tsc`;
 *   3. map each diagnostic back through that record, so the position names the author's file.
 *
 * The CSS text never enters the virtual file — it is not TypeScript and `tsc` would have nothing to
 * say about it. It is checked separately, by a checker that knows CSS.
 *
 * A prototype, and it knows it: the block is found by scanning for `css=@(` rather than by a real
 * parser, and the mapping is per-expression rather than a source map. Both are the real work.
 *
 *     node packages/css/prototype-typecheck.mjs packages/css/example.tsx
 */
import { readFileSync } from "node:fs";
import ts from "typescript";

const file = process.argv[2];
if (file === undefined) {
  console.error("usage: node prototype-typecheck.mjs <file.tsx>");
  process.exit(1);
}
const original = readFileSync(file, "utf8");

// ---- 1. the transform, and the record of where each expression went -------------------------

/** @type {{ virt: number; orig: number; len: number }[]} */
const carried = [];
let out = "";
let cursor = 0;

for (;;) {
  const at = original.indexOf("css=@(", cursor);
  if (at === -1) {
    out += original.slice(cursor);
    break;
  }
  out += original.slice(cursor, at);

  // Walk to the block's closing paren. `{{ … }}` holes are skipped whole, so a paren inside an
  // expression cannot close the block.
  let scan = at + "css=@(".length;
  let depth = 1;
  const holes = [];
  while (scan < original.length && depth > 0) {
    if (original.startsWith("{{", scan)) {
      const end = original.indexOf("}}", scan + 2);
      holes.push({ start: scan + 2, end });
      scan = end + 2;
      continue;
    }
    if (original[scan] === "(") depth++;
    else if (original[scan] === ")") depth--;
    scan++;
  }

  let emitted = 'css={__block("hash", {';
  holes.forEach((hole, index) => {
    emitted += ` "--r${index}": (`;
    carried.push({ virt: out.length + emitted.length, orig: hole.start, len: hole.end - hole.start });
    emitted += `${original.slice(hole.start, hole.end)}),`;
  });
  emitted += " })}";
  out += emitted;
  cursor = scan;
}

const preamble = "declare function __block(hash: string, values: Record<string, string>): string;\n";
const virtual = preamble + out;
for (const segment of carried) segment.virt += preamble.length;

// ---- 2. typecheck the virtual file -----------------------------------------------------------

const NAME = "virtual.tsx";
const host = ts.createCompilerHost({});
const readFileFromDisk = host.readFile.bind(host);
const getSourceFromDisk = host.getSourceFile.bind(host);
host.readFile = (name) => (name.endsWith(NAME) ? virtual : readFileFromDisk(name));
host.getSourceFile = (name, language) =>
  name.endsWith(NAME)
    ? ts.createSourceFile(name, virtual, language, true, ts.ScriptKind.TSX)
    : getSourceFromDisk(name, language);
host.fileExists = (name) => name.endsWith(NAME) || ts.sys.fileExists(name);

const program = ts.createProgram(
  [NAME],
  {
    jsx: ts.JsxEmit.Preserve,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    noEmit: true,
  },
  host,
);

// ---- 3. map back -------------------------------------------------------------------------------

function place(text, position) {
  const before = text.slice(0, position);
  return { line: before.split("\n").length, column: position - before.lastIndexOf("\n") };
}

const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.file !== undefined);
let mapped = 0;

for (const diagnostic of diagnostics) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  const segment = carried.find((s) => diagnostic.start >= s.virt && diagnostic.start < s.virt + s.len);
  if (segment === undefined) {
    // Not inside a carried expression: it belongs to the scaffolding, not to the author's code.
    console.log(`  [virtual file only, not shown to the author] ${message.slice(0, 90)}…`);
    continue;
  }
  const back = segment.orig + (diagnostic.start - segment.virt);
  const { line, column } = place(original, back);
  console.log(`${file}(${line},${column}): error TS${diagnostic.code}: ${message}`);
  console.log(`      ${original.split("\n")[line - 1].trim()}`);
  mapped++;
}

console.log(`\n${mapped} diagnostic(s) mapped back into ${file}.`);
