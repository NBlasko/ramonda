/**
 * How a POSITIONAL shorthand splits into its longhands, measured out of the engines.
 *
 *     node scripts/css/build-shorthand-shapes.mjs
 *     node scripts/css/build-shorthand-shapes.mjs --check
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
import { loadTs } from "../lib-load-ts.mjs";

// `scripts/`, which every path below is written from.
const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes("--check");

const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const { DOMAINS, PATTERNS, WIDE, holdsVar, learnPositionalIn, misplacedWord, splitPositional, tokensOf } = await import(
  "../../packages/css/shorthand-shapes.mjs"
);
const { SHORTHANDS } = await import("../../packages/css/src/compiler/keywords.generated.ts");

const mdn = createRequire(join(HERE, "build-css-properties.mjs"))("mdn-data");
const COMPILER = join(HERE, "..", "packages", "css", "src", "compiler");
const { parseValueSyntax } = await loadTs(join(COMPILER, "valueSyntax.ts"));
const { acceptedBy } = await loadTs(join(COMPILER, "classify.ts"));
const grammarOf = (one) =>
  one === "color" ? "" : (mdn.css.syntaxes[one]?.syntax ?? mdn.css.properties[one]?.syntax ?? "");

/**
 * Words one longhand of a family takes and another does NOT, per family.
 *
 * A domain's corpus is generic — `length` is all lengths and a `var()` — so it never writes a word
 * the family itself accepts. `background-position` is learned in the length domain and takes
 * `center`, `left`, `x-start`; none of those is ever tried.
 *
 * That matters because of the rule this file already states for negatives: **CSS drops a whole
 * declaration when any part of it is invalid and a split drops only the part.**
 * `background-position: center x-start` is invalid — `background-position-y` has no `x-start` — so
 * the engine sets nothing and a split sets the x. Measured in all three engines before this was
 * written: the page differs, and the corpus had nothing to say about it.
 *
 * So each family's corpus gains the words its own longhands disagree about. A word they all take
 * cannot make a value invalid and is not worth the run.
 */
function disagreedWithin(longhands) {
  const words = longhands.map((one) => {
    const syntax = mdn.css.properties[one]?.syntax ?? "";
    if (syntax === "") return undefined;
    try {
      return new Set(acceptedBy(parseValueSyntax(syntax), grammarOf).words);
    } catch {
      return undefined;
    }
  });
  if (words.some((one) => one === undefined) || words.length < 2) return [];
  const every = new Set(words.flatMap((one) => [...one]));
  return [...every]
    .filter((word) => words.some((one) => !one.has(word)))
    .sort()
    .slice(0, 8);
}

const names = Object.keys(SHORTHANDS).filter((one) => !one.startsWith("-"));
/**
 * What each longhand of a family will take as a WORD, so a split can refuse a value CSS refuses.
 *
 * Only words. A length, a `calc()` or a `var()` is the same to every longhand that takes lengths at
 * all, and the one range question — whether a negative is allowed — is measured separately as
 * `negative`, because the grammar's `[0,∞]` is dropped by the reader.
 *
 * `free` means the longhand takes something no list can hold: a colour name, a `custom-ident`, a
 * string. Those are skipped rather than guessed at — `border-top-color` would otherwise refuse
 * `red`.
 */
function takesWithin(longhands) {
  const out = {};
  for (const one of longhands) {
    const syntax = mdn.css.properties[one]?.syntax ?? "";
    if (syntax === "") {
      out[one] = { words: [], free: true };
      continue;
    }
    try {
      const takes = acceptedBy(parseValueSyntax(syntax), grammarOf);
      const free = ["color", "custom-ident", "string", "dashed-ident", "counter-style"].some((kind) =>
        takes.types.includes(kind),
      );
      out[one] = { words: free ? [] : takes.words.sort(), free };
    } catch {
      out[one] = { words: [], free: true };
    }
  }
  return out;
}

/** Per family, what each of its longhands takes as a word. Computed once, shipped into the page. */
const TAKES = Object.fromEntries(
  names.map((name) => [name, takesWithin(SHORTHANDS[name] ?? [])]).filter(([, one]) => Object.keys(one).length > 0),
);

/** Per family, the words worth adding to its corpus. Computed once, shipped into the page. */
const EXTRA = Object.fromEntries(
  names.map((name) => [name, disagreedWithin(SHORTHANDS[name] ?? [])]).filter(([, words]) => words.length > 0),
);
const file = join(HERE, "..", "packages", "css", "src", "compiler", "shapes.generated.ts");
/**
 * Read BEFORE the engines run, because every engine verifies the committed rows too.
 *
 * A row this machine does not learn used to be neither kept nor rejected — just absent — and the
 * accumulate rule then carried it forward untouched. `perspective-origin` lived there: only WebKit
 * has `perspective-origin-x`, so only WebKit ever checked it, while Chromium and Firefox DROP that
 * declaration and leave the origin unset. Silence read as agreement.
 */
const committed = previousFrom(file, /SHAPES: Readonly<Record<string, Shape>> = (\{[\s\S]*?\n\})\s*;/, {});

/**
 * Every engine, learning and then verifying `against` — which is why this runs TWICE.
 *
 * A family only ONE engine expands is learned only there, so the others never had it to check and
 * their silence was read as agreement. `perspective-origin` came back that way after being removed:
 * WebKit has `perspective-origin-x`, Chromium and Firefox have the shorthand and not the longhands,
 * and they dropped our declaration without ever being asked about it. So the first pass pools what
 * any engine learned, and the second makes every engine answer for all of it.
 */
async function measure(against) {
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
        ([names, DOMAINS, PATTERNS, learn, split, tokens, misplaced, varTest, wide, against, EXTRA, TAKES]) => {
          const learned = new Function(`return ${learn}`)()(names, DOMAINS, PATTERNS);
          // The splitter's own dependencies, put in its scope: it is written to run in a build, not
          // in a page, so injecting it means bringing what it closes over. `misplacedWord` joined them
          // when the word check became a function the checker reads too — and was left out at first,
          // which only the full gate saw: the generator was not run again after that change. And
          // `holdsVar`, when the two `var()` tests became one.
          const splitPositional = new Function(
            `const WIDE = ${JSON.stringify(wide)};\nconst tokensOf = ${tokens};\n` +
              `const misplacedWord = ${misplaced};\nconst holdsVar = ${varTest};\nreturn ${split}`,
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

          /**
           * Whether the family takes a NEGATIVE length, asked of the engine.
           *
           * CSS drops a whole declaration when any part of it is invalid, and a split drops only the
           * part: `padding: 10px -5px` leaves no padding at all, while four longhands leave 10px top
           * and bottom. So a family that refuses negatives must refuse to SPLIT a value holding one,
           * or an author's mistake stops doing nothing and starts doing half of something.
           *
           * Asked rather than listed: all three engines agree exactly which families refuse them —
           * `padding`, `gap`, `border-radius`, `scroll-padding` do, and `margin`, `inset`,
           * `scroll-margin` do not — and a list of that is a fourth copy of something the engine knows.
           */
          const takesNegative = (name) => {
            a.style.cssText = "";
            a.style.cssText = `${name}: -5px`;
            return a.style.cssText !== "";
          };
          /**
           * Whether the family takes a PERCENTAGE, asked the same way and for the same reason.
           *
           * `scroll-margin` takes lengths and no percentage, where `margin` takes both — so the
           * corpus's `10%` failed it in every engine, the family fell to the grammar table, and
           * `scroll-margin: 0 8px` reached the sheet whole. Found by `check-must-split.mjs`.
           */
          const takesPercent = (name) => {
            a.style.cssText = "";
            a.style.cssText = `${name}: 10%`;
            return a.style.cssText !== "";
          };
          for (let [name, shape] of Object.entries({ ...against, ...learned })) {
            const domain = DOMAINS.find((one) => one.kind === shape.kind);
            if (domain === undefined) continue;
            // The splitter reads `takes` to refuse a value a longhand has no word for, so the
            // corpus has to see the same shape the table will carry.
            //
            // `alone` is the words THIS engine takes as a longhand's whole value. `first` and `safe`
            // are only ever part of one — `first baseline`, `safe center` — so a positional slot
            // holding one by itself is a declaration CSS drops. Measured here, intersected below.
            shape = {
              ...shape,
              takes: Object.fromEntries(
                Object.entries(TAKES[name] ?? {}).map(([longhand, takes]) => {
                  if (takes.free) return [longhand, takes];
                  // An engine without the longhand says nothing about it, rather than refusing every
                  // word: Firefox has no `-webkit-border-before-style`, and measuring it there emptied
                  // the list for every engine.
                  a.style.cssText = "";
                  if (getComputedStyle(a).getPropertyValue(longhand) === "") return [longhand, takes];
                  const alone = takes.words.filter((word) => {
                    a.style.cssText = "";
                    a.style.setProperty(longhand, word);
                    return a.style.length > 0;
                  });
                  return [longhand, { ...takes, alone }];
                }),
              ),
            };
            // Measured before the corpus, so the corpus checks the shape the table will carry.
            if (shape.kind === "length")
              shape = { ...shape, negative: takesNegative(name), percent: takesPercent(name) };
            else shape = { ...shape, negative: takesNegative(name) };
            let sound = true;
            for (const pattern of PATTERNS) {
              if (shape.patterns[pattern.key] === undefined || !sound) continue;
              // The domain's own corpus, plus the words this family's longhands disagree about.
              const corpus = [...domain.corpus, ...(EXTRA[name] ?? [])];
              for (const one of corpus) {
                for (const other of corpus) {
                  const values = Array.from({ length: pattern.slots }, (_, at) => (at % 2 === 0 ? one : other));
                  let at = 0;
                  const text = pattern.sides.map((n) => values.slice(at, (at += n)).join(" ")).join(" / ");
                  const mine = splitPositional(shape, text);
                  if (mine === undefined) continue;
                  a.style.cssText = "";
                  b.style.cssText = "";
                  a.style.setProperty(name, text);
                  for (const [longhand, held] of Object.entries(mine)) b.style.setProperty(longhand, held);
                  /**
                   * The WHOLE computed style, not the longhands this engine happens to name.
                   *
                   * Reading `a.style` for the longhand list asked the engine what IT expands the
                   * shorthand into, and skipped the value when the answer was empty — so a family
                   * this engine does not expand was never checked here and was kept as sound.
                   * `transform-origin` and `perspective-origin` got into the table that way: only
                   * WebKit has `transform-origin-x`, so only WebKit verified them, while Chromium and
                   * Firefox DROP that declaration and never set the origin at all. Same for
                   * `border-spacing`, whose `-webkit-` longhands Firefox refuses.
                   *
                   * Comparing everything also answers a question the longhand list cannot: a
                   * shorthand may touch a property outside its own mapping — `padding` and
                   * `padding-inline-start` name the same used value — and a split that misses it
                   * renders differently while every mapped longhand agrees.
                   */
                  const seen = getComputedStyle(a);
                  const ours = getComputedStyle(b);
                  let same = seen.length === ours.length;
                  for (let index = 0; same && index < seen.length; index++) {
                    const held = seen[index];
                    same = seen.getPropertyValue(held) === ours.getPropertyValue(held);
                  }
                  if (!same) {
                    sound = false;
                    break;
                  }
                }
                if (!sound) break;
              }
            }
            if (!sound) rejected.push(name);
            else if (learned[name] !== undefined)
              kept[name] = {
                ...shape,
                negative: takesNegative(name),
                ...(shape.kind === "length" ? { percent: takesPercent(name) } : {}),
              };
          }
          return { kept, rejected, learned };
        },
        [
          names,
          DOMAINS,
          PATTERNS,
          learnPositionalIn.toString(),
          splitPositional.toString(),
          tokensOf.toString(),
          misplacedWord.toString(),
          holdsVar.toString(),
          WIDE,
          against,
          EXTRA,
          TAKES,
        ],
      );
      counts.push([engine, Object.keys(perEngine[engine].kept).length, perEngine[engine].rejected.length]);
      if (process.env.WHY) console.error(`[why] ${engine} rejected: ${perEngine[engine].rejected.join(" ")}`);
    } catch (error) {
      /**
       * A run that stops early is a SHORTER list, silently — the one thing this must not write. But
       * say which kind of stop it was. Every failure used to read *"would not launch"* and advise
       * installing the browser, including a `ReferenceError` in the code handed to a browser that had
       * launched perfectly well; the advice sent the reader the wrong way.
       */
      const launched = browser !== undefined;
      console.error(
        launched
          ? `[shapes] ${engine} launched, and the code run in it failed: ${String(error).slice(0, 160)}`
          : `[shapes] ${engine} would not launch, so the list would be short: ${String(error).slice(0, 90)}`,
      );
      if (!launched)
        console.error(`[shapes] run \`npx playwright install ${engine}\` in apps/playground-core, then this again.`);
      process.exit(1);
    } finally {
      await browser?.close();
    }
  }
  return { perEngine, counts };
}

/** Learn everywhere first, so the second pass can make every engine answer for all of it. */
const pooled = { ...committed };
for (const one of Object.values((await measure(committed)).perEngine))
  for (const [name, shape] of Object.entries(one.learned)) pooled[name] ??= shape;

const { perEngine, counts } = await measure(pooled);

const engines = Object.keys(perEngine);
const agreed = {};
const refused = [];

for (const name of names) {
  const saw = engines.filter((one) => perEngine[one].kept[name] !== undefined);
  if (saw.length === 0) continue;

  const first = perEngine[saw[0]].kept[name];
  if (saw.some((one) => perEngine[one].kept[name].negative !== first.negative)) {
    refused.push(`${name} (the engines disagree about whether it takes a negative length)`);
    continue;
  }
  if (saw.some((one) => perEngine[one].kept[name].percent !== first.percent)) {
    refused.push(`${name} (the engines disagree about whether it takes a percentage)`);
    continue;
  }
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
  /**
   * `takes` travels with the shape, and leaving it behind was worse than not having it.
   *
   * The soundness loop above splits with it, so a family is judged under a check the table then did
   * not carry: `place-items` was written as sound because the corpus values it would refuse were
   * refused THERE, and at run time nothing refused them. Measured — `place-items: start
   * space-between` split, and no browser accepts it.
   */
  /**
   * `alone` is the INTERSECTION: a word counts as standing alone only where every engine that has
   * the family takes it as the whole value. Fewer words is more refusals, which is the safe way —
   * `anchor-center` is not taken by Chromium and `scroll-state` not by the other two, and a slot
   * holding either by itself is half of a declaration in the engine that refuses it. Written only
   * where it differs from `words`, which is almost nowhere.
   */
  const takes = Object.fromEntries(
    Object.entries(first.takes ?? {}).map(([longhand, one]) => {
      const bare = { words: one.words, free: one.free };
      // Only the engines that MEASURED this longhand vote; one without it abstained above.
      const lists = saw
        .map((engine) => perEngine[engine].kept[name].takes?.[longhand]?.alone)
        .filter((list) => list !== undefined);
      if (one.free || lists.length === 0) return [longhand, bare];
      const alone = one.words.filter((word) => lists.every((list) => list.includes(word)));
      return [longhand, alone.length === one.words.length ? bare : { ...bare, alone }];
    }),
  );
  if (Object.keys(patterns).length > 0)
    agreed[name] = {
      kind: first.kind,
      negative: first.negative,
      ...(first.percent === undefined ? {} : { percent: first.percent }),
      takes,
      patterns,
    };
}

/**
 * What is committed, kept — see `engine-facts.mjs`. A family a platform does not HAVE is learned
 * nowhere on that machine, and dropping its row would stop the splitter working where it exists.
 * A row this run DID learn replaces the committed one, because that is the measurement.
 */
const previous = committed;

/**
 * A committed row is kept only where this machine learned NOTHING about the family — that is the
 * platform difference `engine-facts.mjs` describes. A family this run learned and then REJECTED is
 * a different thing: it is known to split wrongly, and keeping it would leave a wrong answer in the
 * file because the machine that first wrote it had not checked. Those rows are removed.
 */
const rejected = new Set(engines.flatMap((one) => perEngine[one].rejected));
const merged = { ...previous, ...agreed };
/**
 * ONE engine reproducing a family wrongly ends the claim for everyone — `agreed` is no defence.
 *
 * `agreed` is built from the engines that KEPT a family, so an engine that rejected it was not
 * counted as disagreeing, and a row one engine vouched for outvoted two that had just proved it
 * wrong. `perspective-origin` survived exactly that way: WebKit has `perspective-origin-x` and kept
 * it, Chromium and Firefox both rejected it, and the row stayed.
 *
 * A family a platform genuinely LACKS is not rejected here — neither element takes the declaration,
 * so the two computed styles agree and the check passes. Rejection means something stronger: this
 * engine has the shorthand, took our longhands, and rendered a different page.
 */
for (const name of rejected) delete merged[name];
const sorted = Object.keys(merged).sort();

const wrote = writeOrCheck(
  file,
  `// Generated by scripts/css/build-shorthand-shapes.mjs from Chromium, Firefox and WebKit, MEASURED\n` +
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
    `  /**\n` +
    `   * What each longhand takes as a WORD, so a split can refuse a value CSS refuses.\n` +
    `   *\n` +
    `   * CSS drops a whole declaration when any part of it is invalid and a split drops only the\n` +
    `   * part, so \`background-position: center x-start\` set nothing in a browser and the x here.\n` +
    `   * \`free\` means the longhand takes something no list can hold — a colour name, a\n` +
    `   * \`custom-ident\` — and is not checked.\n` +
    `   */\n` +
    `  readonly takes?: Readonly<Record<string, { readonly words: readonly string[]; readonly free: boolean; readonly alone?: readonly string[] }>>;\n` +
    `  /** Whether it takes a NEGATIVE length. Where it does not, a value holding one is not split. */\n` +
    `  readonly negative: boolean;\n` +
    `  /**\n` +
    `   * Whether a LENGTH family takes a percentage. Where it does not, a value holding one is not\n` +
    `   * split. Absent for any other kind: \`rgb(10% 0% 0%)\` is a colour, not a percentage.\n` +
    `   */\n` +
    `  readonly percent?: boolean;\n` +
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
