import { describe, expect, test } from "vitest";
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
