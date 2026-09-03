// @vitest-environment node
// Reads markdown off disk and touches no DOM, for the same reason `links.test.ts` declares it:
// the config's jsdom default cannot resolve `node:` builtins.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ruleCatalogue } from "@ramonda/check";

/**
 * A number spelled out in prose has to be the number.
 *
 * ## The fault this exists for
 *
 * `/accessibility` opened with "thirty-five of its eighty-five rules". Both halves were wrong at
 * different moments and neither was catchable: the page LISTED thirty-four, because one rule had
 * been dropped from its group while the sentence kept counting it, and the total became
 * eighty-six the day another branch added a rule. Nothing noticed either. Every link resolved,
 * the prose was grammatical, and the only way to see the difference was to count.
 *
 * This is the same shape as the metric mistake the branch it landed on had already made once:
 * a claim that FEELS measured because a number is in it, where what was measured was something
 * else.
 *
 * ## Why only these two numbers
 *
 * Both are derivable — the page's own rule links, and `ruleCatalogue().length`. A count that
 * cannot be derived was REMOVED from `/performance` rather than pinned here: "fifteen rules find
 * this class" is not a fact any code can answer, because "this class" is a judgement about rules
 * and not a field on one. A test that hardcoded it would be the stale number with a second copy.
 */
const here = dirname(fileURLToPath(import.meta.url));
const content = join(here, "..", "..", "content");

/** English for 1-999, which is the whole range a rule count will plausibly occupy. */
function spelled(n: number): string {
  const ones = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (n < 20) return ones[n] as string;
  if (n < 100)
    return n % 10 === 0 ? (tens[Math.floor(n / 10)] as string) : `${tens[Math.floor(n / 10)]}-${ones[n % 10]}`;
  const rest = n % 100;
  return rest === 0
    ? `${ones[Math.floor(n / 100)]} hundred`
    : `${ones[Math.floor(n / 100)]} hundred and ${spelled(rest)}`;
}

const page = readFileSync(join(content, "accessibility.md"), "utf8");
const linked = new Set([...page.matchAll(/\]\(\/rules\/([a-z0-9-]+)\)/g)].map(([, id]) => id));

describe("the numbers /accessibility spells out", () => {
  it("finds the rules it links to, so the checks below are not vacuous", () => {
    expect(linked.size).toBeGreaterThan(20);
    for (const id of linked) expect(ruleCatalogue().map((rule) => rule.id)).toContain(id);
  });

  it("claims as many accessibility rules as it links to", () => {
    expect(page).toContain(`**${spelled(linked.size)} of its `);
  });

  it("claims the number of rules there actually are", () => {
    const total = spelled(ruleCatalogue().length);
    expect(page).toContain(`of its ${total} rules**`);
    expect(page).toContain(`all ${total},`);
  });

  it("can tell a wrong number from a right one", () => {
    // The control. Without it a matcher that passed on anything would make the three above unable
    // to fail — which is exactly how the original sentence stayed wrong.
    expect(spelled(35)).toBe("thirty-five");
    expect(spelled(86)).toBe("eighty-six");
    expect(page).not.toContain(`**${spelled(linked.size + 1)} of its `);
  });
});
