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
};

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
          if (!takes.some(Boolean)) return values.map(() => "absent");
          return values.map((value, at) => {
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
