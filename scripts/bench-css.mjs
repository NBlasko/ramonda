/**
 * How long `@ramonda/css` takes per file, on a project large enough to show it.
 *
 *     node scripts/bench-css.mjs [files] [--profile]
 *
 * Writes a synthetic project to a temporary folder — `files` components of ten blocks each, every one
 * importing a shared `@@keyframes` and spreading a shared block — and times the three paths a real
 * project takes through the compiler: `transform` (what a bundler runs per file), `checkSource` in the
 * editor's forgiving read (what a keystroke runs), and `virtualFile` (what the editor type-checks).
 * It also counts how often an imported module is read, which is work a build can share.
 *
 * Built `dist` is what is measured, so build the package first. `--profile` prints the functions that
 * took the most time in `transform` and in `checkSource`, from a CPU profile of a second run.
 *
 * Not a gate on timings — those differ between machines, and a gate that fails on a busy laptop is a
 * gate people learn to ignore. The gate runs it on a few files so the script cannot rot.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Session } from "node:inspector/promises";

const here = dirname(fileURLToPath(import.meta.url));
const COMPILER = join(here, "..", "packages", "css", "dist", "compiler", "index.js");
const count = Number(process.argv.find((one) => /^\d+$/.test(one)) ?? 1000);
const profile = process.argv.includes("--profile");

if (!existsSync(COMPILER)) {
  console.error("[bench] build @ramonda/css first: pnpm --filter @ramonda/css build");
  process.exit(1);
}
const compiler = await import(pathToFileURL(COMPILER).href);

const root = mkdtempSync(join(tmpdir(), "ramonda-css-bench-"));
mkdirSync(join(root, "src"));
writeFileSync(
  join(root, "src", "shared.tsx"),
  `export const fade = @@keyframes( from { opacity: 0; } to { opacity: 1; } );\n` +
    `export const base = @@( display: flex; gap: 8px; padding: 4px 8px; );\n`,
);
for (let file = 0; file < count; file++) {
  const blocks = [];
  for (let block = 0; block < 10; block++) {
    const colour = (file * 7 + block).toString(16).padStart(6, "0").slice(-6);
    blocks.push(
      `  const s${block} = @@(\n` +
        `    ...$(base);\n` +
        `    color: #${colour};\n` +
        `    margin: ${block}px ${file % 13}px;\n` +
        `    border: 1px solid #ccc;\n` +
        `    &:hover { opacity: 0.${block}; }\n` +
        `    @media (min-width: 40rem) { padding: ${block * 2}px; }\n` +
        `    when $(on) { background: red; } else { background: blue; }\n` +
        `    font-size: match $(tone) { a => 12px; b => 14px; _ => 16px; };\n` +
        `    animation: $(fade) 1s;\n` +
        `  );`,
    );
  }
  writeFileSync(
    join(root, "src", `C${file}.tsx`),
    `import { base, fade } from "./shared";\ndeclare const on: boolean;\ndeclare const tone: "a" | "b" | "c";\n` +
      `export function C${file}() {\n${blocks.join("\n")}\n  return [${blocks.map((_, b) => `s${b}`).join(", ")}];\n}\n`,
  );
}

const files = readdirSync(join(root, "src"))
  .filter((name) => name.startsWith("C"))
  .map((name) => join(root, "src", name));
const texts = files.map((file) => readFileSync(file, "utf8"));

let reads = 0;
/** What a bundler adapter hands the compiler: read an imported module, beside the importer. */
const read = (specifier, from) => {
  reads++;
  for (const extension of [".tsx", ".ts"]) {
    const path = resolve(dirname(from), specifier + extension);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return undefined;
};

const time = (label, run) => {
  const started = performance.now();
  run();
  const ms = performance.now() - started;
  console.log(
    `[bench] ${label.padEnd(30)} ${ms.toFixed(0).padStart(6)} ms   ${(ms / files.length).toFixed(3)} ms/file`,
  );
};

console.log(`[bench] ${files.length} files, 10 blocks each`);
time("transform (build)", () => files.forEach((file, i) => compiler.transform(texts[i], { filename: file, read })));
console.log(
  `[bench] ${"imported modules read".padEnd(30)} ${String(reads).padStart(6)}      ${(reads / files.length).toFixed(2)} per file`,
);
time("checkSource (editor)", () =>
  files.forEach((file, i) => compiler.checkSource(texts[i], file, { tolerant: true, read })),
);
time("virtualFile (editor types)", () =>
  files.forEach((_file, i) => compiler.virtualFile(texts[i], { properties: "./properties", tolerant: true })),
);

/** The functions that took the most time in one path, from a CPU profile of a second run. */
const profiled = async (label, run) => {
  const session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.start");
  run();
  const { profile: taken } = await session.post("Profiler.stop");
  session.disconnect();
  const byId = new Map(taken.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const total = taken.timeDeltas.reduce((sum, one) => sum + one, 0);
  taken.samples.forEach((id, index) => {
    const frame = byId.get(id).callFrame;
    const key = `${frame.functionName || "(anonymous)"} ${frame.url.split("/").pop()}:${frame.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + taken.timeDeltas[index]);
  });
  console.log(`[bench] ${label}, by time spent in the function itself:`);
  for (const [key, spent] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`[bench]   ${((spent / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
  }
};

if (profile) {
  await profiled("transform", () => files.forEach((file, i) => compiler.transform(texts[i], { filename: file, read })));
  await profiled("checkSource", () =>
    files.forEach((file, i) => compiler.checkSource(texts[i], file, { tolerant: true, read })),
  );
}

rmSync(root, { recursive: true, force: true });
