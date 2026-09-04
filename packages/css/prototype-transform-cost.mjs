/**
 * What the transform costs on a project that DOES use the feature, everywhere.
 *
 * The earlier bail-out number answered a different and much easier question — what a codebase
 * pays when it uses none of this. The number that matters for a framework is this one: a file
 * where every component carries style blocks, which is what an app built with it looks like.
 *
 * Two costs are measured against the same generated files:
 *
 *   - **the scan**, a single pass that tracks whether it is inside a string, a template or a
 *     comment, because finding `=@(` is not the same as knowing it is a JSX attribute;
 *   - **the whole transform**, which adds parsing each block, hashing it, hoisting a descriptor and
 *     writing the value at the call site.
 *
 * The baseline is esbuild transforming the same files, since that is the cost a dev server
 * already pays and the only honest thing to compare against.
 *
 * A prototype, and it takes one shortcut worth naming: the hoisted descriptors are prepended to the
 * file, so they land above the imports. A real transform puts them below. It changes nothing about
 * the cost being measured.
 *
 *     node packages/css/prototype-transform-cost.mjs [fileCount] [blocksPerFile]
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { globSync } from "node:fs";

// esbuild is a transitive dependency here, so resolve it out of the store rather than declaring
// one for a prototype.
const require = createRequire(import.meta.url);
const esbuildPath = globSync("node_modules/.pnpm/esbuild@*/node_modules/esbuild", { cwd: process.cwd() })[0];
const { transformSync } = require(`${process.cwd()}/${esbuildPath}`);

const FILES = Number(process.argv[2] ?? 1000);
const BLOCKS = Number(process.argv[3] ?? 4);

// ---- a file shaped like a component that uses the feature throughout ---------------------------

function makeFile(n) {
  let out = `import { Component, state, compute } from "@ramonda/core";\n\n`;
  out += `export class View${n} extends Component<{ id: string }> {\n`;
  out += `  @state open = false;\n  @state accent = "#10b981";\n`;
  out += `  @compute get label() { return this.props.id.toUpperCase(); }\n\n  render() {\n    return (\n      <section>\n`;
  for (let b = 0; b < BLOCKS; b++) {
    out += `      <div css=@(
        display: flex;
        flex-direction: column;
        padding: ${8 + b}px 16px;
        background-color: #0f172a;
        border-radius: 6px;
        border-left: {{this.open ? "4px solid " + this.accent : "4px solid #64748b"}};
      )>
        <span>{this.label}</span>
      </div>\n`;
  }
  out += `      </section>\n    );\n  }\n}\n`;
  return out;
}

const sources = Array.from({ length: FILES }, (_, n) => makeFile(n));
const bytes = sources.reduce((total, source) => total + source.length, 0);

// ---- the scan: one pass, lexically aware ------------------------------------------------------

/** Positions of every `=@(` that is really in code, not inside a string, template or comment. */
function findBlocks(source) {
  const found = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source.charCodeAt(i);
    if (c === 47 /* / */) {
      const next = source.charCodeAt(i + 1);
      if (next === 47) {
        i = source.indexOf("\n", i);
        if (i === -1) break;
        continue;
      }
      if (next === 42) {
        i = source.indexOf("*/", i + 2);
        if (i === -1) break;
        i += 2;
        continue;
      }
    } else if (c === 34 /* " */ || c === 39 /* ' */ || c === 96 /* ` */) {
      const quote = c;
      i++;
      while (i < n) {
        const d = source.charCodeAt(i);
        if (d === 92) {
          i += 2;
          continue;
        }
        if (d === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    } else if (c === 61 /* = */ && source.charCodeAt(i + 1) === 64 /* @ */ && source.charCodeAt(i + 2) === 40 /* ( */) {
      found.push(i);
      i += 3;
      continue;
    }
    i++;
  }
  return found;
}

// ---- the whole transform ----------------------------------------------------------------------

function transform(source) {
  const starts = findBlocks(source);
  if (starts.length === 0) return { code: source, css: "" };

  let out = "";
  let cursor = 0;
  let css = "";
  // Descriptors are hoisted to module scope: a block with no holes then costs one allocation for
  // the life of the program rather than one per render.
  const hoisted = [];

  for (const start of starts) {
    // `start` is the `=`; the attribute name sits just before it and is replaced along with it.
    let nameStart = start;
    while (nameStart > 0 && /[A-Za-z]/.test(source[nameStart - 1])) nameStart--;
    out += source.slice(cursor, nameStart);
    let scan = start + 3;
    let depth = 1;
    const chunks = [];
    const holes = [];
    let chunk = "";
    while (scan < source.length && depth > 0) {
      if (source.charCodeAt(scan) === 123 && source.charCodeAt(scan + 1) === 123) {
        const end = source.indexOf("}}", scan + 2);
        holes.push(source.slice(scan + 2, end));
        chunks.push(chunk);
        chunk = "";
        scan = end + 2;
        continue;
      }
      const c = source.charCodeAt(scan);
      if (c === 40) depth++;
      else if (c === 41) {
        depth--;
        if (depth === 0) break;
      }
      chunk += source[scan];
      scan++;
    }
    chunks.push(chunk);

    let text = chunks[0];
    holes.forEach((_, index) => {
      text += `var(--r${index})${chunks[index + 1]}`;
    });
    const normalised = text.replace(/\s+/g, " ").trim();
    const className = `r-${createHash("sha256").update(normalised).digest("hex").slice(0, 8)}`;
    css += `.${className}{${normalised}}\n`;

    // A VALUE, never a built string — see DESIGN.md. The expressions are transplanted verbatim
    // into value positions, so the compiler concatenates nothing and escapes nothing.
    const id = `_s${hoisted.length}`;
    const names = holes.map((_, index) => `"--r${index}"`).join(",");
    hoisted.push(`const ${id} = block("${className}"${holes.length === 0 ? "" : `,[${names}]`});`);
    out += holes.length === 0 ? `css={${id}}` : `css={[${id},${holes.join(",")}]}`;
    cursor = scan + 1;
  }
  out += source.slice(cursor);
  return { code: `${hoisted.join("\n")}\n${out}`, css };
}

// ---- measure ----------------------------------------------------------------------------------

function time(label, work, rounds) {
  work();
  const start = performance.now();
  for (let round = 0; round < rounds; round++) work();
  const each = (performance.now() - start) / rounds;
  console.log(
    `${label.padEnd(34)} ${each.toFixed(1).padStart(8)} ms   ${(bytes / 1e6 / (each / 1000)).toFixed(0).padStart(5)} MB/s`,
  );
  return each;
}

console.log(`${FILES} files, ${BLOCKS} blocks each = ${FILES * BLOCKS} blocks, ${(bytes / 1e6).toFixed(2)} MB\n`);

time(
  "scan only (lexically aware)",
  () => {
    for (const s of sources) findBlocks(s);
  },
  10,
);
const whole = time(
  "scan + parse + hash + emit",
  () => {
    for (const s of sources) transform(s);
  },
  10,
);
const transformed = sources.map((s) => transform(s).code);
const baseline = time(
  "esbuild, the same files (tsx)",
  () => {
    for (const s of transformed) transformSync(s, { loader: "tsx", jsx: "automatic", target: "es2022" });
  },
  3,
);

console.log(`\nper file        ${((whole / FILES) * 1000).toFixed(1)} µs`);
console.log(`on top of esbuild   +${((whole / baseline) * 100).toFixed(1)}%`);
