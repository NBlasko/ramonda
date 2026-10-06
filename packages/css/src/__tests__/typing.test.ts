import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { Config } from "../config/config";
import { kind } from "../config/declared";
import { checkSource } from "../compiler/source";
import { virtualFile } from "../compiler/virtual";

/**
 * Every construct of the block's logic, typed one character at a time.
 *
 * An editor asks about every one of those states, and a throw in any of them takes every request
 * with it — completion, the squiggles, hover — for as long as the word is being typed. Found by
 * doing exactly this through the plugin: `match`, `match ` and `match $` threw, and so did a choice
 * whose condition names a keyframes block. The forgiving read and the two things built on it are
 * what an editor runs, so they are what is typed through here; the full plugin is too slow to walk
 * every prefix of every construct on each run.
 */

const TARGETS: Record<string, string> = {
  chain: "when $(on) {\n    color: red;\n  } else when $(off) {\n    color: blue;\n  } else {\n    color: gray;\n  }",
  "block match": "match $(tone) {\n    hot => ( color: red; padding: 4px; );\n    _ => ( color: gray; );\n  }",
  "value match": "color: match $(tone) { hot => red; _ => blue; };",
  choice: "border: $(on) ? 2px solid red : $(off) ? 1px solid blue : none;",
  "choice on a keyframes name": "animation-name: $(slide) ? a : b;",
  spread: "...$(base);",
  variable: "padding: $space.gutter;",
  "registered name": "$(angle): 45deg;",
};

const HEAD =
  `declare const on: boolean;\ndeclare const off: boolean;\ndeclare const tone: "hot" | "cold";\n` +
  `const base = @@( color: red; );\nconst slide = @@keyframes( from { opacity: 0; } );\n` +
  `const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );\n` +
  `export const a = <div className={@@(\n  display: flex;\n  `;
const TAIL = `\n)}>x</div>;\nexport const after = 1;\n`;

describe("every prefix of every construct", () => {
  test.each(Object.entries(TARGETS))("%s never throws in the editor's read", (_name, target) => {
    const failed: string[] = [];
    for (let n = 0; n <= target.length; n++) {
      const source = `${HEAD}${target.slice(0, n)}${TAIL}`;
      try {
        virtualFile(source, { properties: "./properties", tolerant: true });
        checkSource(source, "/A.tsx", { tolerant: true });
      } catch (error) {
        failed.push(`${JSON.stringify(target.slice(0, n))}: ${String(error).slice(0, 80)}`);
      }
    }

    expect(failed).toEqual([]);
  });
});

/**
 * Review round 5: the same sweep for what this branch added, with every strict option on — the
 * editor reads each keystroke forgivingly, and a throw there takes completion and every squiggle
 * with it. And once the construct is whole and correct, it must report nothing: a strict option
 * that reported a half-typed name is noise, one that reports the finished correct one is a fault.
 */
describe("every prefix of every new construct, with every strict option on", () => {
  const dir = mkdtempSync(join(tmpdir(), "ramonda-typing-"));
  mkdirSync(join(dir, "img"));
  writeFileSync(join(dir, "img", "a.png"), "PNG");
  const file = join(dir, "Card.tsx");
  const config: Config = {
    tokens: { $color: kind("color", { accent: "#10b981", moving: { value: "#fff", range: ["#fff", "#000"] } }) },
    externalCustomProperties: ["--mui-primary"],
    unknownCustomProperties: "same-block",
    styleOtherElements: false,
    properties: { "<color>": { hardcoded: false } },
  };
  const INSIDE: Record<string, string> = {
    "a relative url": `background: url("./img/a.png");`,
    "a font through its binding": "font-family: $(brand), serif;",
    "a local custom property": "--gap: 4px;\n  padding: var(--gap);",
    "an outside name": "border-color: var(--mui-primary);",
    "a ranged token set": "--color-moving: #000;",
    "a registered property set": "$(angle): 45deg;\n  transform: rotate(var($(angle)));",
    "a state of the element": "&:hover { opacity: 0.9; }",
    "itself under an ancestor": `[data-theme="dark"] & { color: $color.accent; }`,
  };
  const HEAD_IN =
    `declare const on: boolean;\n` +
    `const brand = @@font-face( font-family: "B"; src: url("./img/a.png"); );\n` +
    `const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );\n` +
    `export const a = <div className={@@(\n  display: flex;\n  `;
  const TAIL_IN = `\n)}>x</div>;\nexport { brand, angle };\n`;

  test.each(Object.entries(INSIDE))("%s: never throws, and whole it reports nothing", (_name, target) => {
    const failed: string[] = [];
    for (let n = 0; n <= target.length; n++) {
      const source = `${HEAD_IN}${target.slice(0, n)}${TAIL_IN}`;
      try {
        virtualFile(source, { properties: "./properties", tolerant: true });
        checkSource(source, file, { tolerant: true, config });
      } catch (error) {
        failed.push(`${JSON.stringify(target.slice(0, n))}: ${String(error).slice(0, 80)}`);
      }
    }
    const whole = checkSource(`${HEAD_IN}${target}${TAIL_IN}`, file, { tolerant: true, config }).map(
      (one) => `${one.rule}: ${one.message.slice(0, 60)}`,
    );

    expect(failed).toEqual([]);
    expect(whole).toEqual([]);
  });

  test("a @@keyframes setting a registered property: never throws, and whole it reports nothing", () => {
    const target = "@@keyframes( from { $(angle): 0deg; } to { $(angle): 90deg; } );";
    const head = `const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );\nexport const turn = `;
    const failed: string[] = [];
    for (let n = 0; n <= target.length; n++) {
      try {
        checkSource(`${head}${target.slice(0, n)}\nexport { angle };\n`, file, { tolerant: true, config });
      } catch (error) {
        failed.push(`${JSON.stringify(target.slice(0, n))}: ${String(error).slice(0, 80)}`);
      }
    }

    expect(failed).toEqual([]);
    expect(checkSource(`${head}${target}\nexport { angle };\n`, file, { tolerant: true, config })).toEqual([]);
  });
});
