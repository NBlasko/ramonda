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
  background: "red",
  mask: "none",
  font: "12px serif",
  "animation-range": "normal",
  "timeline-trigger": "none",
  "grid-template": "none",
  grid: "none",
  "mask-border": "none",
  "grid-row": "1",
  "grid-column": "1",
  "border-radius": "1px",
  "overscroll-behavior": "auto",
  "place-items": "center",
  "place-self": "center",
  "place-content": "center",
  columns: "2",
  container: "none",
  "text-decoration": "none",
  "text-emphasis": "dot",
  offset: "none",
  "border-image": "none",
  "interest-delay": "normal",
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
  background: [
    "red",
    "none",
    "transparent",
    "#abc",
    "rgb(1 2 3)",
    "url(a.png)",
    "url(a.png) red",
    "red url(a.png)",
    "url(a.png) no-repeat",
    "url(a.png) repeat-x fixed",
    "url(a.png) space round",
    "url(a.png) center",
    "url(a.png) center / cover",
    "url(a.png) center/contain",
    "url(a.png) left 10px top 5px / 10px 20px",
    "url(a.png) 0 0 / auto 50%",
    "content-box",
    "content-box padding-box",
    "url(a.png) border-box red",
    "linear-gradient(red, blue)",
    "linear-gradient(red, blue), url(a.png) no-repeat",
    "url(a.png), url(b.png) red",
    "url(a.png) red, url(b.png)",
    "red, blue",
    "local",
    "fixed url(a.png) right bottom",
    "no-repeat repeat",
    "url(a.png) / cover",
    "center / 10px 20px 30px",
    "url(a.png) url(b.png)",
    "bogus",
    "url(a.png) bogus",
    "repeat-x repeat-y",
    "top left / 50%",
    "currentcolor",
    "canvas",
    "border-box border-box border-box",
    "url(a.png) center top 5px / 10px",
    "rgba(0, 0, 0, 0.5) url(a.png)",
  ],
  mask: [
    "none",
    "url(#m)",
    "url(a.png)",
    "linear-gradient(black, transparent)",
    "url(a.png) no-repeat",
    "url(a.png) center / contain",
    "url(a.png) left 10px top 5px / 10px 20px",
    "url(a.png) content-box",
    "url(a.png) content-box padding-box",
    "url(a.png) no-clip",
    "url(a.png) no-clip content-box",
    "url(a.png) content-box no-clip",
    "url(a.png) subtract",
    "url(a.png) luminance",
    "url(a.png) alpha exclude",
    "url(a.png), linear-gradient(black, transparent) intersect",
    "url(a.png) repeat-x fill-box",
    "url(a.png) view-box stroke-box",
    "url(a.png) margin-box",
    "url(a.png) space round",
    "url(a.png) left 10px top",
    "url(a.png) red",
    "url(a.png) url(b.png)",
    "bogus",
    "url(a.png) add add",
    "url(a.png) no-clip no-clip",
    "url(a.png) border-box padding-box content-box",
    "a, , b",
  ],
  font: [
    "12px serif",
    "12px/1.5 serif",
    "bold 12px serif",
    "italic bold 12px/20px Georgia, serif",
    "small-caps 1em sans-serif",
    "condensed 12px serif",
    "normal normal normal normal 12px serif",
    "oblique 10deg 12px serif",
    "600 12px serif",
    "italic small-caps bold condensed 16px/2 'Helvetica Neue', Arial, sans-serif",
    '12px "Times New Roman"',
    "large serif",
    "150% serif",
    "12px/normal monospace",
    "calc(10px + 1em) serif",
    "bolder 12px serif",
    "12px system-ui",
    "12px Open Sans, serif",
    "caption",
    "menu",
    "12px",
    "serif",
    "bold serif",
    "12px/ serif",
    "12px, serif",
    "12px serif,",
    "italic italic 12px serif",
    "normal normal normal normal normal 12px serif",
    "12px 1.5 serif",
    "12px/1.5",
    "smaller cursive",
  ],
  "animation-range": [
    "normal",
    "cover",
    "contain",
    "entry",
    "exit",
    "entry-crossing",
    "exit-crossing",
    "cover 10%",
    "20%",
    "cover contain",
    "cover 10% contain 90%",
    "10% 90%",
    "entry 10% exit",
    "cover 10% 20%",
    "10% cover 5%",
    "normal normal",
    "0",
    "0 100%",
    "calc(10% + 5px) exit",
    "cover, 10% 90%",
    "entry, exit 20%",
    "bogus",
    "10% 20% 30%",
    "cover contain entry",
    "cover, ",
    "scroll",
  ],
  "timeline-trigger": [
    "--a --b",
    "--a --b cover",
    "--a --b / contain",
    "none",
    "--a",
    "--a view()",
    "--a view() cover",
    "--a view() cover 10% contain 90%",
    "--a view() cover / contain",
    "--a auto",
    "--a scroll()",
    "--a view() normal",
    "--a, --b",
    "--a view() cover 10%",
    "--a cover",
    "--a view() / 10% 90%",
    "--a view() entry / exit 20%",
    "--a scroll(root block) contain",
    "view() --a",
    "--a view() /",
    "a",
    "--a --b",
    "--a view() cover / contain / exit",
  ],
  "grid-template": [
    "none",
    "10px 20px / 1fr 2fr",
    '"a b" "c d"',
    '"a b" 10px "c d" 20px / 1fr 2fr',
    '[x] "a b" 10px [y] [z] "c d" / [p] 1fr [q] 2fr',
    "repeat(2, 1fr) / auto",
    "auto / auto",
    '"a" minmax(10px, 1fr) / [s] 1fr [e]',
    "[a] 10px [b] / [c] 20% [d]",
    "fit-content(10px) / min-content max-content",
    '"a" [x]',
    '[x] "a" [y] "b" [z]',
    "subgrid / subgrid",
    '"a" / repeat(auto-fill, 10px)',
    "10px / repeat(auto-fill, 10px)",
    '"a" "b" / 10px',
    "10px",
    "10px /",
    "/ 10px",
    "10px / 20px / 30px",
    '"a" 10px 20px',
    "[a] [b] 10px / 1fr",
    '"a" subgrid',
    "bogus / 10px",
    '"a b" "c"',
    "none / 10px",
    '"a a" "b a"',
    '"a . b"',
    '"a.b"',
    '"a" "a"',
    '"a a" "a a"',
    '"a$"',
    '[x] [y] "a"',
  ],
  grid: [
    "none",
    "10px / auto-flow 20px",
    "auto-flow dense 10px / 1fr",
    '"a" 10px / 1fr',
    "auto-flow / 1fr",
    "10px / dense auto-flow",
    "dense auto-flow / 1fr",
    "10px 20px / 1fr",
    "auto-flow 10px 20px / 1fr 2fr",
    "[a] 10px / auto-flow",
    '"a b" / 1fr 1fr',
    "auto-flow / auto-flow",
    "10px / auto-flow dense dense",
    "auto-flow",
    "10px",
    "auto-flow 10px",
    "row / 1fr",
    "10px / 20px auto-flow",
  ],
  "mask-border": [
    "none",
    "url(a.png)",
    "url(a.png) 30",
    "url(a.png) 30 fill",
    "url(a.png) fill 30",
    "url(a.png) 30 / 10px",
    "url(a.png) 30 / 10px / 2px",
    "url(a.png) 30 / / 2px",
    "url(a.png) 30 / 10px / 2px round",
    "round",
    "url(a.png) 10% 20% 30% 40% space round",
    "url(a.png) round stretch",
    "linear-gradient(red, blue) 20",
    "url(a.png) 30 /",
    "url(a.png) 30 / 10px /",
    "url(a.png) fill",
    "url(a.png) 30 fill fill",
    "30 url(a.png)",
    "url(a.png) 1 2 3 4 5",
    "url(a.png) 30 / auto 10px",
    "bogus",
  ],
  "grid-row": [
    "1",
    "2",
    "-1",
    "a",
    "span 2",
    "span a",
    "2 a",
    "1 / 3",
    "1 / -1",
    "a / b",
    "span 2 / 5",
    "auto",
    "auto / 3",
    "a / b / c",
    "span",
    "1 2",
    "0",
    "span 0",
  ],
  "grid-column": ["1", "2", "-1", "a", "span 2", "1 / -1", "span 2 / span 3", "a 2 / b", "/", "1 /", "span -1"],
  "border-radius": [
    "1px",
    "50%",
    "4px 8px",
    "1px 2px 3px",
    "1px 2px 3px 4px",
    "10px / 20px",
    "1px 2px 3px 4px / 5px",
    "1px 2px / 3px 4px 5px",
    "1px / 2px 3px 4px 5px",
    "0",
    "-1px",
    "1px 2px 3px 4px 5px",
    "1px / ",
    "1px / 2px / 3px",
    "calc(1px + 5%)",
  ],
  "overscroll-behavior": [
    "auto",
    "contain",
    "none",
    "auto none",
    "none contain",
    "contain contain",
    "auto auto auto",
    "scroll",
  ],
  "place-items": [
    "center",
    "center start",
    "first baseline",
    "last baseline",
    "baseline",
    "safe center",
    "unsafe end",
    "stretch",
    "normal",
    "center legacy right",
    "center right legacy",
    "legacy left",
    "start left",
    "left",
    "anchor-center",
    "first baseline center",
    "safe center unsafe start",
    "space-between",
    "self-start self-end",
    "auto",
    "center safe",
  ],
  "place-self": [
    "center",
    "last baseline",
    "auto end",
    "safe start",
    "auto",
    "left",
    "start right",
    "normal stretch",
    "legacy",
    "anchor-center end",
  ],
  "place-content": [
    "center",
    "space-between",
    "safe center end",
    "center space-around",
    "first baseline",
    "baseline",
    "start left",
    "stretch",
    "normal",
    "space-evenly center",
    "left",
    "safe left",
    "unsafe right start",
    "auto",
  ],
  columns: [
    "2",
    "200px",
    "2 200px",
    "200px 2",
    "auto",
    "auto 3",
    "3 auto",
    "auto auto",
    "0",
    "10%",
    "-2",
    "2 3",
    "200px 300px",
    "1.5",
    "calc(10px + 5em)",
  ],
  container: [
    "card",
    "card / inline-size",
    "a b / size",
    "none",
    "x / normal",
    "none / size",
    "card / bogus",
    "card / size / x",
    "and",
    "a / ",
    "/ size",
  ],
  "text-decoration": [
    "none",
    "underline",
    "underline overline",
    "underline dotted red",
    "line-through 2px",
    "overline wavy blue 3px",
    "underline from-font",
    "red",
    "dashed",
    "none underline",
    "underline underline",
    "underline 10%",
    "blink",
    "spelling-error",
  ],
  "text-emphasis": [
    "dot",
    "filled circle red",
    "open triangle",
    "'x' blue",
    "none",
    "filled",
    "open",
    "red",
    "circle circle",
    "'x' dot",
    "sesame open",
  ],
  offset: [
    "none",
    "auto",
    "normal",
    "path('M0 0 L10 10')",
    "10px 20px",
    "none 10px",
    "left top path('M0 0 L1 1')",
    "ray(45deg) 10px",
    "ray(45deg closest-side) / 40px 20px",
    "url(a.svg) 30deg",
    "url(a.svg) auto 30deg",
    "url(a.svg) reverse",
    "url(a.svg) 10% auto 90deg",
    "url(a.svg) 2cm / 0.5cm 3cm",
    "url(a.svg) / auto",
    "url(a.svg) 30deg 30deg",
    "url(a.svg) 10px 20px",
    "path('M0 0') / left",
    "bogus",
    "/ 10px",
    "url(a.svg) / 1 / 2",
  ],
  "border-image": [
    "none",
    "linear-gradient(red, blue) 27",
    "url(a.png) 27 space",
    "linear-gradient(red, blue) 27 / 35px",
    "url(a.png) 27 23 / 50px 30px / 1rem round space",
    "url(a.png) 30 fill",
    "url(a.png) fill 10%",
    "url(a.png) 10 / / 2px",
    "url(a.png) 10 / auto 1",
    "round",
    "url(a.png) 10 /",
    "url(a.png) 1 2 3 4 5",
    "bogus",
  ],
  "interest-delay": ["normal", "1s", "1s 2s", "normal normal", "200ms normal", "1s 2s 3s", "red"],
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
      let here = 0;
      for (const { at, what } of found) {
        if (what === "refused") refused.push(`${engine} ${family}: ${values[at]}`);
        else if (what !== "") wrong.push(`${engine} ${family}: \`${values[at]}\` — ${what}`);
        else here++;
      }
      compared += here;
      /**
       * A family that splits NOTHING here is a fault too. A refusal is silent and safe, so a hand
       * rule that stopped reading every value of its family would pass every row above — and each
       * value would reach the sheet whole, which is what splitting exists to end.
       */
      if (here === 0) wrong.push(`${engine} ${family}: no value of its corpus split at all`);
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
