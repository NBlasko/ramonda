/**
 * The splitter, reading the generated table, against what the engines actually render.
 *
 *     node scripts/css/check-shorthand-split.mjs
 *     SELFTEST=slot node scripts/css/check-shorthand-split.mjs
 *     SELFTEST=half node scripts/css/check-shorthand-split.mjs   # splits a value no engine takes; must fail     # must FAIL
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
import { loadTs } from "../lib-load-ts.mjs";
import { caughtIt } from "../lib-selftest.mjs";

// `scripts/`, which every path below is written from.
const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const selftest = process.env.SELFTEST;

const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const { DOMAINS, PATTERNS, splitPositional } = await import("../../packages/css/shorthand-shapes.mjs");
const { SHAPES } = await loadTs(join(HERE, "..", "packages", "css", "src", "compiler", "shapes.generated.ts"));
/** Families split by hand FIRST are not split by this table at all — see `splitOf`. */
const { BY_HAND } = await loadTs(join(HERE, "..", "packages", "css", "src", "compiler", "splitByHand.ts"));

/**
 * Every value to try, per family, built from its own domain's corpus across every pattern — and
 * from the WORDS the family's longhands take.
 *
 * The domain's corpus alone is the sentinels a shape was LEARNED from, so a word that behaves
 * differently was never asked. `animation-range` was learned from lengths, and its words do not
 * follow the lengths: `cover` alone runs to `cover`, not to `normal`. The table split it wrong in
 * every engine that has it, and this passed.
 */
function casesFor(shape) {
  const domain = DOMAINS.find((one) => one.kind === shape.kind);
  if (domain === undefined) return [];
  const words = [...new Set(Object.values(shape.takes ?? {}).flatMap((one) => one.words ?? []))];
  const corpus = [...domain.corpus, ...words];
  const out = [];
  for (const pattern of PATTERNS) {
    if (shape.patterns[pattern.key] === undefined) continue;
    for (const one of corpus) {
      for (const other of corpus) {
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

const wrong = [];
let tried = 0;
const halfApplied = [];
/** Per engine, per family: the values it TAKES, or `null` where it has no such family. */
const taken = {};

/**
 * In EVERY engine, one batch per family: whether it has the family, which values it takes, and for
 * each of those whether our longhands compute what the shorthand computes.
 *
 * Chromium alone used to be asked the last question, and Firefox and WebKit only the first two — so
 * a slot mapped to a longhand one of them drops, or computes differently, passed.
 *
 * "Has the family" is asked directly, by `initial`, rather than read off the values taken: an engine
 * that has the family and refuses every candidate would otherwise count as not having it, and its
 * refusals would be heard nowhere.
 */
for (const engine of ["chromium", "firefox", "webkit"]) {
  const browser = await pw[engine].launch();
  const tab = await browser.newPage();
  await tab.setContent(
    "<!doctype html><html><body><style>#a,#b{--x:1px 2px;--c:red blue;--s:solid dashed;--o:auto hidden;" +
      "--i:url(a.png);--a:start end;--k:round bevel;--w:pre nowrap;--v:sub super;--n:1 2}</style>" +
      "<div id=a></div><div id=b></div></body></html>",
  );
  taken[engine] = {};
  for (const [name, shape] of Object.entries(shapes)) {
    if (BY_HAND[name] !== undefined) continue;
    const cases = casesFor(shape)
      .map((value) => [value, splitPositional(shape, value)])
      .filter(([, mine]) => mine !== undefined);
    const answer = await tab.evaluate(
      ([name, cases]) => {
        const a = document.getElementById("a");
        const b = document.getElementById("b");
        a.style.cssText = "";
        a.style.setProperty(name, "initial");
        if (a.style.length === 0) return null;
        const kept = [];
        const differs = [];
        for (const [value, mine] of cases) {
          a.style.cssText = "";
          b.style.cssText = "";
          a.style.setProperty(name, value);
          if (a.style.length === 0) continue;
          kept.push(value);
          for (const [longhand, held] of Object.entries(mine)) b.style.setProperty(longhand, held);
          /**
           * The WHOLE computed style, not the longhands this engine names — a family this engine
           * does not expand is still checked, which is how `transform-origin` and `border-spacing`
           * were found: their longhands exist in one engine only.
           */
          const seen = getComputedStyle(a);
          const ours = getComputedStyle(b);
          const differ = [];
          for (let index = 0; index < seen.length; index++) {
            const one = seen[index];
            if (seen.getPropertyValue(one) !== ours.getPropertyValue(one))
              differ.push(`${one}: ${seen.getPropertyValue(one)} vs ${ours.getPropertyValue(one)}`);
          }
          if (differ.length > 0) differs.push([value, differ.slice(0, 4), mine]);
        }
        return { kept, differs };
      },
      [name, cases],
    );
    taken[engine][name] = answer === null ? null : answer.kept;
    if (answer === null) continue;
    tried += answer.kept.length;
    for (const [value, differ, mine] of answer.differs)
      wrong.push(
        wrong.length < 6 ? { name: `${engine} ${name}`, value, differ, mine } : { name: `${engine} ${name}`, value },
      );
  }
  await browser.close();
}

/**
 * And a value one engine takes and another that HAS the family refuses must not be split at all.
 * CSS drops a declaration it refuses whole, and a split drops only the part an engine does not
 * take — so the rest applies where the author's line would have done nothing: `text-wrap: pretty`
 * in Firefox. One that no engine takes is invalid CSS, which the checker refuses before a build.
 */
for (const [name, shape] of Object.entries(shapes)) {
  if (BY_HAND[name] !== undefined) continue;
  const values = casesFor(shape).filter((value) => splitPositional(shape, value) !== undefined);
  // The break: a value one engine takes and another does not, as if the table split it.
  if (selftest === "half" && name === "padding") {
    const one = taken.chromium.padding?.[0];
    taken.firefox.padding = (taken.firefox.padding ?? []).filter((each) => each !== one);
  }
  for (const value of new Set(values)) {
    const having = Object.entries(taken).filter(
      ([, families]) => families[name] !== null && families[name] !== undefined,
    );
    const takers = having.filter(([, families]) => families[name].includes(value)).map(([engine]) => engine);
    const refusers = having.filter(([, families]) => !families[name].includes(value)).map(([engine]) => engine);
    if (takers.length > 0 && refusers.length > 0)
      halfApplied.push(`${name}: \`${value}\` — taken by ${takers.join(", ")}, refused by ${refusers.join(", ")}`);
  }
}

console.log(`[split] ${Object.keys(shapes).length} families, ${tried} values`);

if (halfApplied.length > 0 && selftest === "half") caughtIt("split", selftest, halfApplied);
if (halfApplied.length > 0) {
  console.error(
    `[split] ${halfApplied.length} value(s) an engine refuses are split anyway, so the rest would apply there:`,
  );
  for (const one of halfApplied.slice(0, 20)) console.error(`[split]   ${one}`);
  process.exit(1);
}
if (selftest === "half") {
  console.error("[split] SELFTEST=half changed nothing — this check would not catch it.");
  process.exit(1);
}

if (wrong.length > 0 && selftest) caughtIt("split", selftest, wrong, (one) => `${one.name}: \`${one.value}\``);
if (wrong.length > 0) {
  console.error(`[split] ${wrong.length} of ${tried} values split into a different page:`);
  const per = new Map();
  for (const one of wrong) per.set(one.name, (per.get(one.name) ?? 0) + 1);
  console.error(`[split]   by family: ${[...per].map(([name, count]) => `${name} ${count}`).join(", ")}`);
  for (const one of wrong.slice(0, 6)) {
    console.error(`[split]   ${one.name}: \`${one.value}\``);
    if (one.differ !== undefined) {
      for (const line of one.differ) console.error(`[split]     ${line}   (shorthand vs our longhands)`);
      console.error(`[split]     we split into          ${JSON.stringify(one.mine)}`);
    }
  }
  console.error(`[split] regenerate with \`node scripts/css/build-shorthand-shapes.mjs\`, or fix the splitter.`);
  process.exit(1);
}

if (selftest) {
  console.error(`[split] SELFTEST=${selftest} changed nothing — this check would not catch it.`);
  process.exit(1);
}
console.log(`[split] every value splits into the page the shorthand made`);
