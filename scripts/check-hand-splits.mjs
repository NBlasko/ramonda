/**
 * The families split by hand, against the engines.
 *
 *     node scripts/check-hand-splits.mjs
 *     SELFTEST=flex node scripts/check-hand-splits.mjs    # swaps `flex`'s two factors; must fail
 *     SELFTEST=forget node scripts/check-hand-splits.mjs  # drops a longhand a split must reset
 *
 * `splitByHand.ts` writes CSS's own rules out — `white-space: pre` is `preserve` and `nowrap`,
 * `grid-area: a` names all four lines. The specification is not the oracle; the engines are. Every
 * value below goes into Chromium, Firefox and WebKit twice, once as the shorthand and once as what
 * `splitOf` returns, and every computed property is compared.
 *
 * Two faults, and the second is the one CSS makes easy to miss:
 *
 * - the split computes something else than the shorthand;
 * - the engine REFUSES the shorthand and we split it anyway. CSS drops a whole declaration that is
 *   invalid; a split drops only the part an engine does not take, and applies the rest. So a value
 *   one engine refuses must not be split at all.
 *
 * An engine that does not have a family at all says nothing about it — Firefox has no `text-box`.
 * A value we refuse is not a fault: it keeps its shorthand, which is always right.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./lib-load-ts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const selftest = process.env.SELFTEST;
const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const COMPILER = join(HERE, "..", "packages", "css", "src", "compiler");
const { splitOf } = await loadTs(join(COMPILER, "split.ts"));
const { BY_HAND } = await loadTs(join(COMPILER, "splitByHand.ts"));

const split =
  selftest === "forget"
    ? (property, value) => {
        // Leaves `text-wrap-mode` out of every `white-space` split — found only after another value.
        const out = splitOf(property, value);
        if (property !== "white-space" || out === undefined) return out;
        const { "text-wrap-mode": _dropped, ...rest } = out;
        return rest;
      }
    : selftest === "flex"
      ? (property, value) => {
          const out = splitOf(property, value);
          if (property !== "flex" || out === undefined) return out;
          return { ...out, "flex-grow": out["flex-shrink"], "flex-shrink": out["flex-grow"] };
        }
      : splitOf;

/** A value every engine that has the family takes, to tell "does not have it" from "refuses this". */
const PROBE = {
  marker: "none",
  "white-space": "normal",
  "font-synthesis": "none",
  "-webkit-text-stroke": "1px red",
  "contain-intrinsic-size": "10px",
  flex: "1",
  "grid-area": "auto",
  "text-box": "normal",
  "-webkit-border-before": "1px solid red",
  "background-position": "1px 2px",
  "mask-position": "1px 2px",
  "-webkit-mask-position": "1px 2px",
};

/** Every form a `<position>` takes, and the ones it does not — shared by the three position families. */
const POSITIONS = [
  "1px 2px",
  "center",
  "left",
  "top",
  "right bottom",
  "bottom right",
  "top left",
  "left top",
  "10% 20%",
  "left 10px",
  "10px top",
  "top 10px",
  "center center",
  "left center",
  "center top",
  "left 10px top 5px",
  "top 5px left 10px",
  "right 3px bottom 10%",
  "left 10px top",
  "left top 5px",
  "center top 5px",
  "left 10px center",
  "right 10px center",
  "bottom 10px right",
  "center left 5px",
  "0 0",
  "-5px 3em",
  "calc(10px + 5%) 0",
  "0 0, 10px 10px",
  "left top, center",
  "right 3px bottom 1px, 50% 50%",
  "left right",
  "top bottom",
  "10px 20px 30px",
  "left 10px 20px",
  "1px, ",
  "5 5",
  "center 10px top",
  "left 10px top 5px bottom",
  "10px left",
];

const CORPUS = {
  marker: ["none", "url(#a)", "url(a.svg#m)", "none none", "url(#a) none", "red"],
  "white-space": [
    "normal",
    "pre",
    "pre-wrap",
    "pre-line",
    "nowrap",
    "break-spaces",
    "collapse",
    "preserve",
    "preserve-breaks",
    "wrap",
    "preserve nowrap",
    "nowrap preserve",
    "collapse wrap",
    "break-spaces nowrap",
    "preserve-breaks nowrap",
    "discard",
    "preserve-spaces",
    "pre nowrap",
    "wrap wrap",
    "normal nowrap",
  ],
  "font-synthesis": [
    "none",
    "weight",
    "style",
    "small-caps",
    "position",
    "weight style",
    "style weight",
    "weight style small-caps",
    "small-caps weight",
    "weight weight",
    "none weight",
    "weight position",
  ],
  "-webkit-text-stroke": [
    "1px red",
    "red 1px",
    "2px",
    "blue",
    "thin",
    "thick green",
    "0",
    "rgb(1 2 3) 3px",
    "1px 2px",
    "red blue",
  ],
  "contain-intrinsic-size": [
    "none",
    "10px",
    "10px 20px",
    "auto 10px",
    "auto none",
    "auto 10px auto 20px",
    "10px auto 20px",
    "auto 10px 20px",
    "none 10px",
    "auto",
    "auto auto 10px",
    "10px 20px 30px",
    "calc(10px + 1em)",
  ],
  flex: [
    "none",
    "auto",
    "0",
    "1",
    "2",
    "0.5",
    "1 2",
    "2 3 10px",
    "10px",
    "10%",
    "10px 2",
    "2 10px",
    "2 3",
    "10px 2 3",
    "2 10px 3",
    "content",
    "max-content",
    "1 0",
    "0 0 auto",
    "1 1 0%",
    "3 auto",
    "auto 3",
    "0px",
    "1 1 1",
    "calc(10px + 5%)",
    "fit-content",
  ],
  "grid-area": [
    "auto",
    "a",
    "1",
    "-1",
    "a / b",
    "1 / 2",
    "a / b / c",
    "a / b / c / d",
    "1 / 2 / 3 / 4",
    "span 2",
    "span a",
    "2 a",
    "a 2",
    "span 2 a",
    "a / span 2",
    "span 2 / a",
    "auto / auto",
    "a / 2",
    "1 / a",
    "a / b / 3",
    "auto / a",
    "span",
    "a / b / c / d / e",
    "2 / span 3 / 4",
    "-2 a / 3",
  ],
  "text-box": [
    "normal",
    "none",
    "trim-start",
    "trim-end",
    "trim-both",
    "cap",
    "cap alphabetic",
    "text",
    "text text",
    "ex alphabetic",
    "trim-both cap alphabetic",
    "cap alphabetic trim-start",
    "auto",
    "trim-end auto",
    "cap trim-both alphabetic",
    "ideographic ideographic-ink",
    "none auto",
    "ex text",
    "text alphabetic trim-end",
    "ideographic",
    "cap ideographic",
  ],
  "background-position": POSITIONS,
  "mask-position": POSITIONS,
  "-webkit-mask-position": POSITIONS,
  "-webkit-border-before": [
    "1px solid red",
    "solid",
    "red",
    "2px",
    "dashed 3px blue",
    "blue dotted",
    "thin",
    "none",
    "medium double",
    "1px 2px",
    "solid dashed",
  ],
};

const wrong = [];
const refused = [];
let compared = 0;

for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
    const tab = await browser.newPage();
    await tab.setContent("<!doctype html><html><body><div id=x>t</div><div id=y>t</div></body></html>");

    for (const family of Object.keys(BY_HAND)) {
      const has = await tab.evaluate(
        ([property, value]) => {
          const x = document.getElementById("x");
          x.style.cssText = "";
          x.style.setProperty(property, value);
          return x.style.length > 0;
        },
        [family, PROBE[family]],
      );
      if (!has) continue;

      /**
       * Every value AFTER every other value, and not only on a fresh element.
       *
       * On a fresh element a longhand the split forgot to reset still reads its initial value on
       * both sides, and the comparison passes. Written after another value that set it, the
       * shorthand resets it and a forgetful split leaves the earlier value standing. One call per
       * family, because the pairs are the corpus squared.
       */
      const values = CORPUS[family];
      const splits = values.map((value) => split(family, value) ?? null);
      const found = await tab.evaluate(
        ([property, values, splits]) => {
          const x = document.getElementById("x");
          const y = document.getElementById("y");
          const takes = values.map((value) => {
            x.style.cssText = "";
            x.style.setProperty(property, value);
            return x.style.length > 0;
          });
          const out = [];
          values.forEach((value, at) => {
            if (splits[at] === null) {
              if (takes[at]) out.push({ at, what: "refused" });
              return;
            }
            if (!takes[at]) {
              out.push({ at, what: "the engine refuses the shorthand, and we split it" });
              return;
            }
            // `null` is the fresh element; then each other value this engine takes, first.
            for (const before of [null, ...values.keys()]) {
              if (before !== null && (!takes[before] || splits[before] === null)) continue;
              x.style.cssText = "";
              y.style.cssText = "";
              if (before !== null) {
                x.style.setProperty(property, values[before]);
                for (const [longhand, held] of Object.entries(splits[before])) y.style.setProperty(longhand, held);
              }
              x.style.setProperty(property, value);
              for (const [longhand, held] of Object.entries(splits[at])) y.style.setProperty(longhand, held);
              const wrote = getComputedStyle(x);
              const mine = getComputedStyle(y);
              for (let index = 0; index < wrote.length; index++) {
                const one = wrote[index];
                if (wrote.getPropertyValue(one) !== mine.getPropertyValue(one)) {
                  const after = before === null ? "" : `, after \`${values[before]}\``;
                  out.push({
                    at,
                    what: `${one}: ${wrote.getPropertyValue(one)} vs ${mine.getPropertyValue(one)}${after}`,
                  });
                  return;
                }
              }
            }
            out.push({ at, what: "" });
          });
          return out;
        },
        [family, values, splits],
      );
      for (const { at, what } of found) {
        if (what === "refused") refused.push(`${engine} ${family}: ${values[at]}`);
        else if (what !== "") wrong.push(`${engine} ${family}: \`${values[at]}\` — ${what}`);
        else compared++;
      }
    }
  } catch (error) {
    console.error(`[hand] ${engine} would not launch, or the code failed: ${String(error).slice(0, 160)}`);
    process.exit(1);
  } finally {
    await browser?.close();
  }
}

console.log(`[hand] ${Object.keys(BY_HAND).length} families, ${compared} splits identical to the shorthand`);
if (process.env.WHY) for (const one of refused) console.log(`[hand]   refused, kept whole: ${one}`);

if (wrong.length > 0) {
  console.error(`[hand] ${wrong.length} split(s) differ from what the shorthand does:`);
  for (const one of process.env.WHY ? wrong : wrong.slice(0, 20)) console.error(`[hand]   ${one}`);
  process.exit(selftest ? 0 : 1);
}
if (selftest) {
  console.error(`[hand] SELFTEST=${selftest} changed nothing — this check would not catch it.`);
  process.exit(1);
}
console.log("[hand] every split writes the page its shorthand writes, in every engine that has it");
