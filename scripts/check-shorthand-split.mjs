/**
 * The splitter, reading the generated table, against what the engines actually render.
 *
 *     node scripts/check-shorthand-split.mjs
 *     SELFTEST=slot node scripts/check-shorthand-split.mjs     # must FAIL
 *
 * ## Why this is the gate and `--check` on the generator is not
 *
 * `build-shorthand-shapes.mjs --check` asks whether the TABLE still matches the engines. This asks
 * the question after it: does `splitPositional`, reading that table, produce the same page as the
 * shorthand did. Those are different failures — a table can be right and the code that reads it
 * wrong — and only the second one is what an author would see.
 *
 * ## How it compares
 *
 * Two elements. The shorthand goes on one, our longhands on the other, and the COMPUTED values are
 * compared. Comparing the specified text instead calls every normalisation a bug — `0` against
 * `0px`, `#abc` against `rgb(170, 187, 204)` — and buries the real finding under a hundred false
 * ones. That was measured, more than once.
 *
 * A value the engine refuses outright is not this splitter's problem and is skipped. A value the
 * splitter REFUSES is skipped too: refusing is a correct answer, for a pattern the family was never
 * taught, for a CSS-wide keyword beside a real value, and for a `var()`.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./lib-load-ts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const selftest = process.env.SELFTEST;

const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const { DOMAINS, PATTERNS, splitPositional } = await import("../packages/css/shorthand-shapes.mjs");
const { SHAPES } = await loadTs(join(HERE, "..", "packages", "css", "src", "compiler", "shapes.generated.ts"));

/** Every value to try, per family, built from its own domain's corpus across every pattern. */
function casesFor(shape) {
  const domain = DOMAINS.find((one) => one.kind === shape.kind);
  if (domain === undefined) return [];
  const out = [];
  for (const pattern of PATTERNS) {
    if (shape.patterns[pattern.key] === undefined) continue;
    for (const one of domain.corpus) {
      for (const other of domain.corpus) {
        const values = Array.from({ length: pattern.slots }, (_, index) => (index % 2 === 0 ? one : other));
        let at = 0;
        out.push(pattern.sides.map((n) => values.slice(at, (at += n)).join(" ")).join(" / "));
      }
    }
  }
  return out;
}

/**
 * The break, which is the half that makes the rest mean anything: one slot index moved. It is the
 * smallest wrong answer this can give — the value lands in a real longhand, just the wrong one.
 */
const shapes = structuredClone(SHAPES);
if (selftest === "slot") {
  const mapping = shapes["padding"]?.patterns["4"];
  if (mapping !== undefined) {
    const keys = Object.keys(mapping);
    mapping[keys[0]] = { slots: [1] };
  }
}

const browser = await pw.chromium.launch();
const tab = await browser.newPage();
await tab.setContent(
  "<!doctype html><html><body><style>#a,#b{--x:1px 2px;--c:red blue;--s:solid dashed;--o:auto hidden;" +
    "--i:url(a.png);--a:start end;--k:round bevel;--w:pre nowrap;--v:sub super;--n:1 2}</style>" +
    "<div id=a></div><div id=b></div></body></html>",
);

const wrong = [];
let tried = 0;

for (const [name, shape] of Object.entries(shapes)) {
  for (const value of casesFor(shape)) {
    const mine = splitPositional(shape, value);
    if (mine === undefined) continue;
    const answer = await tab.evaluate(
      ([name, value, mine]) => {
        const a = document.getElementById("a");
        const b = document.getElementById("b");
        a.style.cssText = "";
        b.style.cssText = "";
        a.style.setProperty(name, value);
        const longhands = [];
        for (let index = 0; index < a.style.length; index++) {
          const one = a.style[index];
          if (one !== name) longhands.push(one);
        }
        if (longhands.length === 0) return null;
        for (const [longhand, held] of Object.entries(mine)) b.style.setProperty(longhand, held);
        const read = (element) => longhands.map((one) => getComputedStyle(element).getPropertyValue(one)).join(" | ");
        return [read(a), read(b)];
      },
      [name, value, mine],
    );
    if (answer === null) continue;
    tried++;
    const [rendered, ours] = answer;
    if (rendered !== ours && wrong.length < 6) wrong.push({ name, value, rendered, ours, mine });
    else if (rendered !== ours) wrong.push({ name, value });
  }
}
await browser.close();

console.log(`[split] ${Object.keys(shapes).length} families, ${tried} values`);

if (wrong.length > 0) {
  console.error(`[split] ${wrong.length} of ${tried} values split into a different page:`);
  for (const one of wrong.slice(0, 6)) {
    console.error(`[split]   ${one.name}: \`${one.value}\``);
    if (one.rendered !== undefined) {
      console.error(`[split]     the shorthand renders  ${one.rendered}`);
      console.error(`[split]     our longhands render   ${one.ours}`);
      console.error(`[split]     we split into          ${JSON.stringify(one.mine)}`);
    }
  }
  console.error(`[split] regenerate with \`node scripts/build-shorthand-shapes.mjs\`, or fix the splitter.`);
  process.exit(selftest ? 0 : 1);
}

if (selftest) {
  console.error(`[split] SELFTEST=${selftest} changed nothing — this check would not catch it.`);
  process.exit(1);
}
console.log(`[split] every value splits into the page the shorthand made`);
