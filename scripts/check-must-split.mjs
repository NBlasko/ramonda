/**
 * Values that MUST split — and split into the page their shorthand makes.
 *
 *     node scripts/check-must-split.mjs
 *     SELFTEST=refuse node scripts/check-must-split.mjs   # refuses `grid-column`; must fail
 *
 * ## The fault this is for
 *
 * Every other gate asks whether a split is RIGHT. None asks whether a value splits at all, and a
 * refusal is silent: the value keeps its shorthand, the page is still correct, and nothing says the
 * split stopped. That is how `grid-column: 1 / -1`, `columns: 2` and `place-items: first baseline`
 * reached the sheet whole while every engine took them — the tables were learned from sentinels, and
 * a negative line number, a unitless count or a two-word alignment was never one of them.
 *
 * So this is a list of values people WRITE, each of which every engine that has its family takes.
 * Each must split, and the split must compute what the shorthand computes, on a fresh element and
 * after every other value of its family — the way `check-hand-splits.mjs` asks.
 *
 * A value one engine refuses does not belong here: it keeps its shorthand on purpose, since CSS
 * drops it whole there and a split would not.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./lib-load-ts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const selftest = process.env.SELFTEST;
const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const { splitOf } = await loadTs(join(HERE, "..", "packages", "css", "src", "compiler", "split.ts"));

const split = (property, value) =>
  selftest === "refuse" && property === "grid-column" ? undefined : splitOf(property, value);

/** Family → values. Grouped so each value is also asked after the others of its family. */
const MUST = {
  padding: ["8px", "8px 16px", "0 8px 0", "1px 2px 3px 4px"],
  margin: ["0 auto", "-8px", "0 0 16px"],
  inset: ["0", "10px 20px", "auto 0 0"],
  gap: ["8px", "8px 16px", "normal"],
  border: ["1px solid #ccc", "none", "2px dashed red"],
  "border-radius": ["4px", "50%", "4px 8px", "10px / 20px", "1px 2px 3px 4px / 5px", "1px 2px / 3px 4px 5px"],
  outline: ["none", "2px solid blue", "1px dotted"],
  background: ["#fff", "url(a.png) center / cover no-repeat", "linear-gradient(red, blue)"],
  font: ["14px/1.5 system-ui", "bold 16px serif", "italic 12px 'Helvetica Neue', Arial"],
  flex: ["1", "0 0 auto", "1 1 200px", "none"],
  "flex-flow": ["row wrap", "column"],
  overflow: ["hidden", "hidden auto"],
  "overscroll-behavior": ["contain", "auto none", "none contain"],
  "place-items": ["center", "center start", "first baseline", "last baseline", "safe center", "unsafe end", "stretch"],
  "place-self": ["center", "last baseline", "auto end", "safe start"],
  "place-content": ["center", "space-between", "safe center end", "center space-around"],
  "grid-area": ["1 / 1 / 2 / 3", "a", "span 2 / span 3"],
  "grid-column": ["1 / -1", "span 2", "span 2 / 5", "1 / 3", "a", "2"],
  "grid-row": ["span 2", "1 / 3", "-1", "a / b"],
  columns: ["2", "200px", "2 200px", "200px 2", "auto", "auto 3"],
  container: ["card", "card / inline-size", "sidebar / inline-size", "a b / size", "none", "x / normal"],
  "text-decoration": ["none", "underline", "underline overline", "underline dotted red", "line-through 2px"],
  "text-emphasis": ["dot", "filled circle red", "open triangle", "'x' blue"],
  "list-style": ["none", "square inside", "disc"],
  transition: ["opacity 0.2s ease", "all 1s", "opacity 0.3s, transform 0.2s ease-in"],
  animation: ["spin 1s linear infinite", "fade 0.3s ease-out both", "spin 1s, fade 2s"],
  offset: ["none", "path('M0 0 L10 10')"],
  "white-space": ["nowrap", "pre-wrap"],
  "interest-delay": ["normal normal", "1s", "1s 2s"],
  "timeline-trigger": ["--a --b", "--a --b cover", "--a view()"],
  // Every other family that splits, so each is also asked value after value — the grammar families
  // above all, which no other gate asks in pairs.
  "padding-block": ["8px", "4px 8px"],
  "padding-inline": ["0 16px", "8px"],
  "margin-block": ["0 16px", "auto"],
  "margin-inline": ["auto", "0 auto", "-4px 8px"],
  "inset-block": ["0", "10px auto"],
  "inset-inline": ["0", "auto 10px"],
  "scroll-padding": ["8px", "4px 8px 12px 16px", "auto"],
  "scroll-padding-block": ["8px", "4px 8px"],
  "scroll-padding-inline": ["8px", "auto 8px"],
  "scroll-margin": ["8px", "4px 8px 12px 16px"],
  "scroll-margin-block": ["8px", "4px 8px"],
  "scroll-margin-inline": ["8px", "0 8px"],
  "grid-gap": ["8px", "8px 16px"],
  "border-width": ["1px", "1px 2px", "thin medium thick 3px"],
  "border-style": ["solid", "solid dashed", "none dotted double groove"],
  "border-color": ["red", "red blue", "red green blue #000"],
  "border-block-width": ["1px", "1px 2px"],
  "border-block-style": ["solid", "solid dashed"],
  "border-block-color": ["red", "red blue"],
  "border-inline-width": ["1px", "1px 2px"],
  "border-inline-style": ["solid", "solid dashed"],
  "border-inline-color": ["red", "red blue"],
  "border-top": ["1px solid red", "none", "2px dashed"],
  "border-right": ["1px solid red", "thick"],
  "border-bottom": ["1px solid #ccc", "none"],
  "border-left": ["4px solid blue", "dotted"],
  "border-block": ["1px solid red", "none"],
  "border-block-start": ["1px solid red", "2px dashed"],
  "border-block-end": ["1px solid red", "blue"],
  "border-inline": ["1px solid red", "none"],
  "border-inline-start": ["4px solid blue", "dotted"],
  "border-inline-end": ["1px solid red", "thick double"],
  "column-rule": ["1px solid #ccc", "none", "thick dotted red"],
  "font-synthesis": ["none", "weight", "weight style", "style small-caps"],
  "-webkit-text-stroke": ["1px red", "2px", "blue"],
  "contain-intrinsic-size": ["100px", "100px 200px", "auto 300px", "none", "auto 100px auto 200px"],
  "text-box": ["normal", "trim-both", "cap alphabetic", "trim-start text"],
  "animation-range": ["normal", "entry", "entry 10% exit 90%", "cover 0% cover 100%", "10% 90%"],
  "mask-border": ['url("b.png") 30 round', "none"],
  "mask-position": ["center", "left top", "10px 20px", "right 10px bottom 20px"],
  "-webkit-mask-position": ["center", "10px 20px"],
  "-webkit-border-before": ["1px solid red", "none"],
  marker: ["none", 'url("#m")'],
  "position-try": ["none", "--a", "--a, --b", "most-width --a", "most-height --a, --b, flip-block", "flip-block"],
  "scroll-timeline": ["--a", "--a block", "--a x, --b y"],
  "view-timeline": ["--a", "--a inline", "--a block auto"],
  "corner-shape": ["round", "bevel", "squircle notch", "scoop bevel round square"],
  "corner-top-shape": ["round", "bevel scoop"],
  "corner-right-shape": ["round", "bevel scoop"],
  "corner-bottom-shape": ["round", "bevel scoop"],
  "corner-left-shape": ["round", "bevel scoop"],
  "corner-block-start-shape": ["round", "bevel scoop"],
  "corner-block-end-shape": ["round", "bevel scoop"],
  "corner-inline-start-shape": ["round", "bevel scoop"],
  "corner-inline-end-shape": ["round", "bevel scoop"],
};

/**
 * From MDN's own examples — each shorthand page's Syntax section — and from every block in this
 * repository's apps and docs. Merged into the list above, duplicates dropped.
 */
const DOCUMENTED = {
  background: ["green", 'url("test.jpg") repeat-y', "border-box red", 'no-repeat center/80% url("../img/image.png")'],
  font: [
    "1.2em sans-serif",
    '1.2em/2 "Fira Sans", sans-serif',
    "italic bold 1.2em monospace",
    "ultra-condensed small-caps 1.2em Montserrat, Helvetica, sans-serif",
  ],
  "grid-template": [
    "none",
    "100px 1fr / 50px 1fr",
    "auto 1fr / auto 1fr auto",
    "[line-name] 100px / [column-name1] 30% [column-name2] 70%",
    "fit-content(100px) / fit-content(40%)",
    '"a a a" "b b b"',
    '"a a a" 20% "b b b" auto',
    '[header-top] "a a a" [header-bottom] [main-top] "b b b" 1fr [main-bottom] / auto 1fr auto',
  ],
  grid: [
    "none",
    '"a" 100px "b" 1fr',
    '[line-name1] "a" 100px [line-name2]',
    '"a" 200px "b" min-content',
    '"a" minmax(100px, max-content) "b" 20%',
    "100px / 200px",
    "minmax(400px, min-content) / repeat(auto-fill, 50px)",
    "200px / auto-flow",
    "30% / auto-flow dense",
    "repeat(3, 200px) / auto-flow 300px",
    "[line1] minmax(20em, max-content) / auto-flow dense 40%",
    "auto-flow / 200px",
    "auto-flow dense / 30%",
    "auto-flow 300px / repeat(3, 200px)",
    "auto-flow dense 40% / [line1] minmax(20em, max-content)",
  ],
  animation: [
    "3s ease-in 1s 2 reverse both paused slide-in",
    "3s linear 1s slide-in",
    "3s slide-in",
    "3s linear slide-in, 3s ease-out 5s slide-out",
  ],
  transition: [
    "margin-right 4s",
    "margin-right 4s 1s",
    "margin-right 4s ease-in-out",
    "margin-right 4s ease-in-out 1s",
    "display 4s allow-discrete",
    "margin-right 4s, color 1s",
    "all 0.5s ease-out allow-discrete",
    "200ms linear 50ms",
    "border-left-width 150ms ease-in-out, padding-left 150ms ease-in-out",
    "none",
  ],
  "border-radius": [
    "10px",
    "10px 5%",
    "2px 4px 2px",
    "1px 0 3px 4px",
    "10px 5% / 20px 30px",
    "10px 5px 2em / 20px 25px 30%",
    "10px 5% / 20px 25em 30px 35em",
    "1em / 5em",
    "4px 3px 6px / 2px 4px",
  ],
  flex: ["2", "auto", "10em", "30%", "min-content", "1 30px", "2 2", "2 2 10%"],
  "place-items": [
    "center stretch",
    "start end",
    "end center",
    "normal start",
    "center normal",
    "start legacy",
    "end normal",
    "self-start legacy",
    "self-end normal",
    "flex-start legacy",
    "flex-end normal",
    "baseline normal",
    "first baseline legacy",
    "last baseline normal",
    "stretch legacy",
  ],
  "place-content": [
    "center start",
    "start center",
    "end left",
    "flex-start center",
    "flex-end center",
    "space-between space-evenly",
    "space-around space-evenly",
    "space-evenly stretch",
    "stretch space-evenly",
  ],
  "place-self": [
    "auto center",
    "normal start",
    "center normal",
    "start auto",
    "end normal",
    "self-start auto",
    "self-end normal",
    "flex-start auto",
    "flex-end normal",
    "anchor-center",
    "baseline normal",
    "first baseline auto",
    "last baseline normal",
    "stretch auto",
  ],
  "grid-area": [
    "auto",
    "auto / auto",
    "auto / auto / auto",
    "auto / auto / auto / auto",
    "some-grid-area",
    "some-grid-area / another-grid-area",
    "4 some-grid-area",
    "4 some-grid-area / 2 another-grid-area",
    "span 3",
    "span 3 / span some-grid-area",
    "2 span / another-grid-area span",
  ],
  "grid-column": [
    "auto / auto",
    "some-grid-area / some-other-grid-area",
    "some-grid-area 4",
    "4 some-grid-area / 6",
    "span some-grid-area",
    "5 some-grid-area span",
    "span 3 / 6",
    "span some-grid-area / span some-other-grid-area",
    "5 some-grid-area span / 2 span",
  ],
  border: [
    "solid",
    "dashed red",
    "1rem solid",
    "thick double #32a1ce",
    "4mm ridge rgb(211 220 50 / 0.6)",
    "1px solid #2a2a2a",
  ],
  "text-decoration": ["underline dotted", "green wavy underline", "underline overline #ff3028"],
  "list-style": [
    "square",
    "inside",
    'url("rocket.svg")',
    'georgian inside url("rocket.svg")',
    'georgian outside url("non-existent.svg")',
  ],
  mask: [
    "none",
    'url("mask.png")',
    'url("masks.svg#star")',
    'url("masks.svg#star") luminance',
    'url("masks.svg#star") 40px 20px',
    'url("masks.svg#star") 0 0/50px 50px',
    'url("masks.svg#star") repeat-x',
    'url("masks.svg#star") exclude',
    'url("masks.svg#star") left / 16px repeat-y, url("masks.svg#circle") right / 16px repeat-y',
  ],
  "border-image": [
    "linear-gradient(red, blue) 27",
    'url("border.png") 27 space',
    "linear-gradient(red, blue) 27 / 35px",
    'url("border.png") 27 23 / 50px 30px / 1rem round space',
  ],
  overflow: ["visible", "clip", "scroll", "auto", "hidden visible"],
  columns: ["18em", "2 auto", "auto 12em", "auto auto"],
  container: ["my-layout", "my-layout / size"],
  offset: [
    "auto",
    "10px 30px",
    "ray(45deg closest-side)",
    'path("M 100 100 L 300 100 L 200 300 z")',
    'url("arc.svg")',
    'url("circle.svg") 100px',
    'url("circle.svg") 40%',
    'url("circle.svg") 30deg',
    'url("circle.svg") 50px 20deg',
    "ray(45deg closest-side) / 40px 20px",
    'url("arc.svg") 2cm / 0.5cm 3cm',
    'url("arc.svg") 30deg / 50px 100px',
    'path("M 20 60 L 120 60 L 70 10 L 20 60") 0% auto 90deg',
    'path("M 20 210 L 74 210 L 118 140 L 62 140 L 20 210") 20% auto',
  ],
  "text-emphasis": [
    "none",
    '"x"',
    '"*" #555555',
    "filled",
    "open",
    "filled sesame",
    "open sesame",
    "filled sesame #555555",
  ],
  outline: ["solid", "dashed #ff6666", "thick inset", "3px solid green", "2px dashed #7c3aed"],
  "font-variant": [
    "normal",
    "no-common-ligatures proportional-nums",
    "common-ligatures tabular-nums",
    "small-caps slashed-zero",
  ],
  inset: ["10px", "4px 8px", "5px 15px 10px", "2.4em 3em 3em 3em", "10% 5% 5% 5%", "auto"],
  gap: [
    "20px",
    "1em",
    "3vmin",
    "0.5cm",
    "16%",
    "calc(10% + 20px)",
    "20px 10px",
    "1em 0.5em",
    "3vmin 2vmax",
    "16% 100%",
    "calc(20px + 10%) calc(10% - 5px)",
    "4px 12px",
  ],
  "white-space": ["normal", "pre", "pre-line", "wrap", "break-spaces", "collapse", "preserve nowrap"],
  "text-wrap": ["wrap", "nowrap", "balance", "stable"],
  margin: ["1em", "-3px", "5% auto", "1em auto 2em", "2px 1em 0 auto", "auto", "calc(1rem + 2px)"],
  "background-position": [
    "top",
    "bottom",
    "left",
    "right",
    "center",
    "25% 75%",
    "0 0",
    "1cm 2cm",
    "10ch 8em",
    "0 0, center",
    "bottom 10px right 20px",
    "right 3em bottom 10px",
    "bottom 10px right",
    "top right 10px",
  ],
};
for (const [family, values] of Object.entries(DOCUMENTED))
  MUST[family] = [...new Set([...(MUST[family] ?? []), ...values])];

const wrong = [];
let asked = 0;

for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
    const tab = await browser.newPage();
    await tab.setContent("<!doctype html><html><body><div id=x>t</div><div id=y>t</div></body></html>");

    for (const [family, values] of Object.entries(MUST)) {
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
          // An engine without the family says nothing about it — Firefox has no `interest-delay`.
          // Asked directly: an engine that HAS the family and takes none of these is not "absent".
          x.style.cssText = "";
          x.style.setProperty(property, "initial");
          if (x.style.length === 0) return values.map(() => "absent");
          return values.map((value, at) => {
            // CSS drops a value it refuses whole; a split would still apply the rest of it.
            if (!takes[at] && splits[at] !== null) return "this engine refuses it, and it was split anyway";
            if (!takes[at]) return "this engine refuses it, so it does not belong on this list";
            if (splits[at] === null) return "it did not split";
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
                  return `${one}: ${wrote.getPropertyValue(one)} vs ${mine.getPropertyValue(one)}${after}`;
                }
              }
            }
            return "";
          });
        },
        [family, values, splits],
      );
      found.forEach((what, at) => {
        if (what === "absent") return;
        asked++;
        if (what !== "") wrong.push(`${engine} ${family}: \`${values[at]}\` — ${what}`);
      });
    }
  } catch (error) {
    console.error(`[must-split] ${engine} would not launch, or the code failed: ${String(error).slice(0, 160)}`);
    process.exit(1);
  } finally {
    await browser?.close();
  }
}

if (wrong.length > 0) {
  console.error(`[must-split] ${wrong.length} of ${asked}:`);
  for (const one of process.env.WHY ? wrong : wrong.slice(0, 20)) console.error(`[must-split]   ${one}`);
  process.exit(selftest ? 0 : 1);
}
if (selftest) {
  console.error(`[must-split] SELFTEST=${selftest} changed nothing — this check would not catch it.`);
  process.exit(1);
}
console.log(`[must-split] ${asked} values across three engines split, into the page their shorthand makes`);
