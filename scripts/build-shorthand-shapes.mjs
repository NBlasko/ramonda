/**
 * How a POSITIONAL shorthand splits into its longhands, measured out of the engines.
 *
 *     node scripts/build-shorthand-shapes.mjs
 *     node scripts/build-shorthand-shapes.mjs --check
 *
 * ## Why this file exists rather than a rule in the compiler
 *
 * `padding: 10px 20px` means top/bottom 10 and left/right 20, and WHICH longhand is position zero
 * is a fact about the property. A table of it written by hand is the third copy of something the
 * engines already know — the mistake `build-shorthand-leaves.mjs` was written to stop making. So
 * each family is fed distinct sentinels in every pattern it accepts, and the engine says which
 * longhand took which.
 *
 * The learning lives in `packages/css/shorthand-shapes.mjs`, beside the splitter that reads what it
 * writes, because `prototype-expand.mjs` measures with the same code.
 *
 * ## Why only the positional ones
 *
 * A positional family needs no classifier when it splits: how many values were written answers it.
 * Every other shape asks *which longhand does this token belong to*, and that was measured
 * unanswerable from what this package generates — 84 of 404 placements, see
 * `prototype-classify-from-tables.mjs`. Those families keep their shorthand, and the cascade keeps
 * deciding for them.
 *
 * ## The merge, and why it is the INTERSECTION
 *
 * `leaves` takes the union, because every fault it was written for was a leaf that was MISSING and
 * a style that survived when plain CSS would have reset it. This list is the opposite shape: a
 * mapping that is WRONG writes the author's value into the wrong longhand, silently. So a pattern
 * is written only when every engine that has the family agrees about it, and a disagreement means
 * the splitter refuses and the shorthand stays whole — which is the answer that cannot be wrong.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { previousFrom, writeOrCheck } from "./engine-facts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes("--check");

const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const { DOMAINS, PATTERNS, WIDE, learnPositionalIn, splitPositional, tokensOf } = await import(
  "../packages/css/shorthand-shapes.mjs"
);
const { SHORTHANDS } = await import("../packages/css/src/compiler/keywords.generated.ts");

const names = Object.keys(SHORTHANDS).filter((one) => !one.startsWith("-"));
const perEngine = {};
const counts = [];

for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
    const tab = await browser.newPage();
    // A DOCTYPE, because quirks mode is a different CSS and no real page is in it.
    // Two elements, because the shape is verified here: the shorthand on one, our longhands on the
    // other. The custom properties hold SEVERAL values on purpose — `padding: var(--x)` with
    // `--x: 1px 2px` is two values to the shorthand and nonsense to a longhand.
    await tab.setContent(
      "<!doctype html><html><body><style>#x,#y{--x:1px 2px;--c:red blue;--s:solid dashed;--o:auto hidden;" +
        "--i:url(a.png);--a:start end;--k:round bevel;--w:pre nowrap;--v:sub super;--n:1 2}</style>" +
        "<div id=x></div><div id=y></div></body></html>",
    );
    perEngine[engine] = await tab.evaluate(
      ([names, DOMAINS, PATTERNS, learn, split, tokens, wide]) => {
        const learned = new Function(`return ${learn}`)()(names, DOMAINS, PATTERNS);
        // The splitter's own two dependencies, put in its scope: it is written to run in a build,
        // not in a page, so injecting it means bringing what it closes over.
        const splitPositional = new Function(
          `const WIDE = ${JSON.stringify(wide)};\nconst tokensOf = ${tokens};\nreturn ${split}`,
        )();
        /**
         * A shape is only written if it SURVIVES its own corpus, here, in the engine that taught it.
         *
         * Learning a shape and writing it down are not the same thing: `position-try` takes the
         * alignment sentinels and so reads as positional, and then splits `normal start` into an
         * order and a fallback of `normal start` where the engine gives `normal` and `start`. The
         * check that found that was a separate gate; a generator that can be wrong and a gate that
         * says so is two places for one fact, so the verification moved in here.
         */
        const a = document.getElementById("x");
        const b = document.getElementById("y");
        const kept = {};
        const rejected = [];
        for (const [name, shape] of Object.entries(learned)) {
          const domain = DOMAINS.find((one) => one.kind === shape.kind);
          if (domain === undefined) continue;
          let sound = true;
          for (const pattern of PATTERNS) {
            if (shape.patterns[pattern.key] === undefined || !sound) continue;
            for (const one of domain.corpus) {
              for (const other of domain.corpus) {
                const values = Array.from({ length: pattern.slots }, (_, at) => (at % 2 === 0 ? one : other));
                let at = 0;
                const text = pattern.sides.map((n) => values.slice(at, (at += n)).join(" ")).join(" / ");
                const mine = splitPositional(shape, text);
                if (mine === null) continue;
                a.style.cssText = "";
                b.style.cssText = "";
                a.style.setProperty(name, text);
                const longhands = [];
                for (let index = 0; index < a.style.length; index++) {
                  const held = a.style[index];
                  if (held !== name) longhands.push(held);
                }
                if (longhands.length === 0) continue;
                for (const [longhand, held] of Object.entries(mine)) b.style.setProperty(longhand, held);
                const read = (element) =>
                  longhands.map((held) => getComputedStyle(element).getPropertyValue(held)).join(" | ");
                if (read(a) !== read(b)) {
                  sound = false;
                  break;
                }
              }
              if (!sound) break;
            }
          }
          if (sound) kept[name] = shape;
          else rejected.push(name);
        }
        return { kept, rejected };
      },
      [names, DOMAINS, PATTERNS, learnPositionalIn.toString(), splitPositional.toString(), tokensOf.toString(), WIDE],
    );
    counts.push([engine, Object.keys(perEngine[engine].kept).length, perEngine[engine].rejected.length]);
  } catch (error) {
    // A browser that will not launch is a SHORTER list, silently — the one thing this must not write.
    console.error(`[shapes] ${engine} would not launch, so the list would be short: ${String(error).slice(0, 90)}`);
    console.error(`[shapes] run \`npx playwright install ${engine}\` in apps/playground-core, then this again.`);
    process.exit(1);
  } finally {
    await browser?.close();
  }
}

const engines = Object.keys(perEngine);
const agreed = {};
const refused = [];

for (const name of names) {
  const saw = engines.filter((one) => perEngine[one].kept[name] !== undefined);
  if (saw.length === 0) continue;

  const first = perEngine[saw[0]].kept[name];
  if (saw.some((one) => perEngine[one].kept[name].kind !== first.kind)) {
    refused.push(`${name} (the engines disagree about which sentinels it takes)`);
    continue;
  }

  /** A pattern every engine that HAS the family wrote the same way. */
  const patterns = {};
  for (const [key, mapping] of Object.entries(first.patterns)) {
    const text = JSON.stringify(mapping);
    if (saw.every((one) => JSON.stringify(perEngine[one].kept[name].patterns[key]) === text)) patterns[key] = mapping;
    else refused.push(`${name} pattern ${key}`);
  }
  if (Object.keys(patterns).length > 0) agreed[name] = { kind: first.kind, patterns };
}

const file = join(HERE, "..", "packages", "css", "src", "compiler", "shapes.generated.ts");

/**
 * What is committed, kept — see `engine-facts.mjs`. A family a platform does not HAVE is learned
 * nowhere on that machine, and dropping its row would stop the splitter working where it exists.
 * A row this run DID learn replaces the committed one, because that is the measurement.
 */
const previous = previousFrom(file, /SHAPES: Readonly<Record<string, Shape>> = (\{[\s\S]*?\n\})\s*;/, {});

/**
 * A committed row is kept only where this machine learned NOTHING about the family — that is the
 * platform difference `engine-facts.mjs` describes. A family this run learned and then REJECTED is
 * a different thing: it is known to split wrongly, and keeping it would leave a wrong answer in the
 * file because the machine that first wrote it had not checked. Those rows are removed.
 */
const rejected = new Set(engines.flatMap((one) => perEngine[one].rejected));
const merged = { ...previous, ...agreed };
for (const name of rejected) if (agreed[name] === undefined) delete merged[name];
const sorted = Object.keys(merged).sort();

const wrote = writeOrCheck(
  file,
  `// Generated by scripts/build-shorthand-shapes.mjs from Chromium, Firefox and WebKit, MEASURED\n` +
    `// rather than read: each browser is launched and asked how it splits each shorthand. No engine\n` +
    `// source is used. See THIRD-PARTY.md. Do not edit.\n` +
    `//\n` +
    `// The POSITIONAL families only — the ones whose split is answered by how many values were\n` +
    `// written. Everything else needs to know which longhand a token belongs to, which is not\n` +
    `// answerable from what this package generates; see \`prototype-classify-from-tables.mjs\`.\n` +
    `//\n` +
    `// A pattern is written only where every engine that HAS the family agreed about it: a mapping\n` +
    `// that is wrong puts the author's value in the wrong longhand, silently, so disagreement means\n` +
    `// the splitter refuses and the shorthand stays whole.\n` +
    `\n` +
    `/** How one longhand takes its value: the written slots it joins, or a constant the family supplies. */\n` +
    `export type Slot = { readonly slots: readonly number[] } | { readonly literal: string };\n` +
    `\n` +
    `/** One family: the sentinel kind it was learned with, and a mapping per value pattern. */\n` +
    `export interface Shape {\n` +
    `  readonly kind: string;\n` +
    `  /** Keyed the way the value is written — \`2\`, \`2/2\`, \`1/1/1/1\`. */\n` +
    `  readonly patterns: Readonly<Record<string, Readonly<Record<string, Slot>>>>;\n` +
    `}\n` +
    `\n` +
    `export const SHAPES: Readonly<Record<string, Shape>> = {\n` +
    sorted.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(merged[name])},\n`).join("") +
    `};\n`,
  "build-shorthand-shapes",
  check,
);

for (const [engine, total, dropped] of counts) {
  console.log(
    `[shapes] ${engine.padEnd(10)} ${String(total).padStart(4)} families, ${dropped} rejected by their own corpus`,
  );
}
if (refused.length > 0) {
  console.log(`[shapes] ${refused.length} not written because the engines disagreed:`);
  for (const one of refused.slice(0, 8)) console.log(`[shapes]   ${one}`);
}
console.log(`[shapes] ${wrote ? "wrote" : "up to date —"} ${sorted.length} families`);
