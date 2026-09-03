import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bloom, brand, declarations, icon, iconMask, panel } from "../index";
import type { IconName } from "../index";

/**
 * The one module whose values belong to more than one surface, and the first tests it has had.
 *
 * `@ramonda/theme` is private and consumed as source: the documentation site's accent, the devtools
 * panel's chrome and the flower in the logo are the same five colours, and this module exists so
 * they are written once. It had a `check-types` script and nothing else — 441 lines, four functions,
 * and `@ramonda/devtools` calling three of them at runtime.
 *
 * What is tested here is the BEHAVIOUR, not the values. A test asserting that a purple is a
 * particular purple is a copy of the table it reads from, and copies are the fault this module was
 * written to remove. What the functions PROMISE is a different matter, and one of those promises
 * names its own CI failure.
 */
describe("declarations", () => {
  /**
   * The promise with a named consequence, quoted from the source: "biome lowercases hex in CSS.
   * Without this the generated file and the formatter rewrite each other forever, and CI fails on
   * whichever ran last."
   *
   * The table is written in UPPER case because that is how the brand is written down, so the
   * lowercasing is not cosmetic — it is what makes the generated stylesheet byte-identical to what
   * the formatter would produce.
   */
  test("hex comes out lowercased, wherever it sits in the value", () => {
    expect(declarations({ accent: "#AB12EF" })).toBe("  --rmd-accent: #ab12ef;");

    // Not just a value that IS a colour: a shadow or a gradient carries two, mid-string.
    const shadow = declarations({ glow: "0 0 8px #FFAA00, inset 0 1px #0AF" });
    expect(shadow).toContain("#ffaa00");
    expect(shadow).toContain("#0af");
    expect(shadow).not.toMatch(/#[0-9A-F]{2,}/);
  });

  /** Nothing in the real table may come out with an upper-case hex, which is the whole point. */
  test("no token in the shipped tables comes out upper-case", () => {
    for (const tokens of [brand, panel]) {
      expect(declarations(tokens as Record<string, string>)).not.toMatch(/#[0-9a-f]*[A-F][0-9a-fA-F]*/);
    }
  });

  /** The prefix, "so a token can never collide with a page's own" — on every line, not just the first. */
  test("every declaration carries the --rmd prefix", () => {
    const lines = declarations({ a: "#000", b: "#111", c: "#222" }).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.trim().startsWith("--rmd-"))).toBe(true);
  });

  /** The indent is a parameter because one consumer writes into a shadow root and one into a file. */
  test("the indent is what the caller asked for", () => {
    expect(declarations({ a: "#000" }, "")).toBe("--rmd-a: #000;");
    expect(declarations({ a: "#000" }, "\t\t")).toBe("\t\t--rmd-a: #000;");
  });

  test("an empty table is an empty string, not a stray newline", () => {
    expect(declarations({})).toBe("");
  });
});

describe("icon", () => {
  /**
   * `aria-hidden`, always — quoted from the source: "every one of these is inside a control that
   * carries its own `title`, so announcing the shape as well would say everything twice."
   *
   * Asserted for EVERY name rather than one, because the attribute is written once in a template
   * and a name that took a different path through the function would be the thing this misses.
   */
  test("every icon is hidden from a screen reader", () => {
    for (const name of allNames()) {
      expect(icon(name)).toContain('aria-hidden="true"');
    }
  });

  test("the colour is the text's, so hover needs no second rule", () => {
    expect(icon("pick")).toContain('fill="currentColor"');
  });

  /** Sized in `em` so it follows whatever it sits beside — and the size reaches BOTH dimensions. */
  test("the size is applied to width and height", () => {
    expect(icon("pick", "2em")).toContain('width="2em"');
    expect(icon("pick", "2em")).toContain('height="2em"');
    // The default is an em too, not a pixel count.
    expect(icon("pick")).toMatch(/width="[\d.]+em"/);
  });

  /**
   * Every name draws something.
   *
   * An empty `d` renders nothing at all, which is what a typo in the path table produces — and a
   * missing icon in a toolbar looks like a styling problem rather than a wrong key.
   */
  test("every icon draws something, and draws it from a move", () => {
    for (const name of allNames()) {
      const path = /<path d="([^"]*)"\/>/.exec(icon(name))?.[1] ?? "";
      // An SVG path has to begin with a move; a `d` that does not is either empty — which renders
      // nothing and reads as a styling problem rather than a wrong key — or malformed.
      expect(path, name).toMatch(/^[Mm]/);
    }
  });
});

describe("iconMask", () => {
  /**
   * The value goes inside `url("…")` in a stylesheet, so a literal `"` in the SVG would end the
   * string early and the declaration would be dropped. It is encoded, and that is what this pins.
   *
   * **It does NOT pin the choice of encoder, and the plant is why the comment says so.** Swapping
   * `encodeURIComponent` for `encodeURI` leaves every assertion here green: both escape `"`. What
   * differs is `#`, which `encodeURI` leaves alone and which starts a fragment in a data URI — and
   * today's paths contain none, so the difference is not observable from outside. Asserting it would
   * mean putting a `#` in the module to have something to measure.
   */
  test("the quotes are percent-encoded, so the value survives inside url()", () => {
    const value = iconMask("pick");
    expect(value.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(value.endsWith('")')).toBe(true);

    const inner = value.slice('url("data:image/svg+xml,'.length, -2);
    expect(inner).not.toContain('"');
    expect(inner).toContain("%22");
  });

  /**
   * And decoding it gives back the same drawing the inline form uses.
   *
   * `pick` rather than a name invented for the test: `icon` indexes a table, so a name that is not
   * in it answers `d="undefined"` and every assertion here passes against nothing. That is what
   * happened — vitest does not type-check, and `tsc` is what said the name did not exist.
   */
  test("it draws the same path as the inline icon", () => {
    const inner = iconMask("pick").slice('url("data:image/svg+xml,'.length, -2);
    const svg = decodeURIComponent(inner);
    const fromMask = /<path d="([^"]*)"\/>/.exec(svg)?.[1];
    const fromIcon = /<path d="([^"]*)"\/>/.exec(icon("pick"))?.[1];

    expect(fromMask).toBe(fromIcon);
  });
});

describe("bloom", () => {
  /** Five petals at 72°, and the first one carries no `transform` — a `rotate(0)` is noise. */
  test("five petals, and the first is not rotated", () => {
    const svg = bloom();
    expect(svg.match(/<ellipse /g)).toHaveLength(5);
    expect(svg.match(/transform="rotate\((\d+)\)"/g)).toEqual([
      'transform="rotate(72)"',
      'transform="rotate(144)"',
      'transform="rotate(216)"',
      'transform="rotate(288)"',
    ]);
  });

  /** The colours come from the table, which is why the purple is written once in the repo. */
  test("the defaults are the brand's", () => {
    const svg = bloom();
    expect(svg).toContain(`fill="${brand.purple}"`);
    expect(svg).toContain(`fill="${brand.gold}"`);
    expect(svg).toContain(`stroke="${brand.purpleDeep}"`);
  });

  /** The panel's copy is white, because it sits on the brand purple where a purple flower is invisible. */
  test("the petals are a parameter", () => {
    expect(bloom({ petals: "#fff" })).toContain('fill="#fff"');
  });

  /**
   * `null` removes the ring and `undefined` does not, which is the distinction the signature makes
   * (`ring?: string | null`) and the one a caller spreading a partial object meets.
   *
   * **What holds it is the destructuring default, not the `=== null` below it** — measured: writing
   * the check as `!ring` leaves all three assertions green, because `{ ring = brand.purpleDeep }`
   * has already turned `undefined` into the default before the check is reached. So this pins the
   * BEHAVIOUR a caller sees and not the spelling; the two differ only for `""`, which nothing
   * sensible passes.
   */
  test("only an explicit null drops the ring", () => {
    expect(bloom({ ring: null })).not.toContain("stroke=");
    expect(bloom({ ring: undefined })).toContain(`stroke="${brand.purpleDeep}"`);
    expect(bloom({})).toContain("stroke=");
  });
});

/**
 * Every key of the path table, read from the SOURCE rather than listed here.
 *
 * Listed, this would be a copy that drifts: a new icon would be added to the module and to nothing
 * else, and the assertions below would go on passing about the icons somebody wrote down once. Read
 * this way, an icon added tomorrow is asserted tomorrow. The same arrangement
 * `DiagnosticsRegistry.test.ts` uses for the diagnostic codes, and for the same reason.
 *
 * The floor is not decoration: if the slice came back empty every loop below would pass without
 * looking at anything.
 */
function allNames(): IconName[] {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts"), "utf8");
  const table = source.slice(source.indexOf("const ICON_PATHS = {"), source.indexOf("export type IconName"));
  const names = [...table.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1] as IconName);

  if (names.length < 5) {
    throw new Error(`[theme] Read only ${names.length} icon names from the source — the slice is broken.`);
  }
  return names;
}
