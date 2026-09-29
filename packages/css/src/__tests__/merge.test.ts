import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SHORTHANDS } from "../compiler/keywords.generated";
import { keyToken, writableProperty } from "../compiler/names";
import { conditionsOf, forget, mergeClassNames, namesOf, shorthands } from "../merge";

/**
 * Composition, which happens at the CALL SITE and nowhere else.
 *
 * A block compiles to CLASSES, and each one carries what its declaration sets — see `keyToken`.
 * Merging two blocks keeps, per thing set, the one written later. **That is the only way the call
 * site can decide anything**, and it was measured: the order of classes in a `class` attribute
 * decides nothing — the stylesheet's order does — so two whole-block classes cannot say which one
 * wins. Keeping one class per thing set means there is never a tie to break.
 *
 * ## It used to be a MAP, and this file used to be written in maps
 *
 * A block was `{ <what it sets>: <the class> }`, because that was where *the thing set* was written
 * down. A map is an object, so a block written in the markup was a new object on every render and a
 * child receiving it re-rendered for nothing — `RMD020`. The key is in the class name now, so the
 * map has nothing left to say and a block is the string it always ended up as.
 *
 * **Every assertion below is the one that was there**, asked of a string. What went with the map is
 * what went with the hole: a value's own custom properties, a hole that never arrived, a descriptor
 * with no map behind it, and the one-slot cache that existed to give an unchanged merge one object
 * — two merges with the same contents are the same STRING now, which is stronger and free.
 */

/** A class the compiler would have produced, so the two halves are asked the same question. */
const classOf = (property: string, value: string, context: { selector?: string; conditions?: string[] } = {}) =>
  `r-${keyToken({ property, selector: context.selector ?? "", conditions: context.conditions ?? [] })}-${value}`;

/**
 * What the emitted module registers, done here the same way — see `clears` in `transform.ts`.
 *
 * A class string cannot carry what a shorthand clears, so the module that writes one registers it.
 * Built from the generated table through the same `writableProperty`, because a test that spelled
 * the property forms itself would be asserting against its own copy.
 */
const registerShorthand = (property: string): readonly string[] => {
  const written = writableProperty(property);
  const covered = SHORTHANDS[property] ?? [];
  const longhands = covered.map(writableProperty).filter((one): one is string => one !== undefined);
  if (written !== undefined) shorthands({ [written]: longhands });
  registerName(property);
  for (const one of covered) registerName(one);
  return covered;
};

/** And what the author called it, which is what the development warning has to say. */
const registerName = (property: string): void => {
  const written = writableProperty(property);
  if (written !== undefined) namesOf({ [written]: property });
};

/** And the conditions a key sits under, which only the development warning reads. */
const registerConditions = (property: string, conditions: readonly string[]): string => {
  const key = keyToken({ property, selector: "", conditions: [...conditions] });
  conditionsOf({ [key]: conditions.join("|") });
  return key;
};

afterEach(forget);

describe("what a merge produces", () => {
  test("one block is that block", () => {
    expect(mergeClassNames(classOf("display", "flex"))).toBe(classOf("display", "flex"));
  });

  test("two blocks setting different things keep both", () => {
    const out = mergeClassNames(classOf("display", "flex"), classOf("color", "red"));

    expect(out.split(" ").sort()).toEqual([classOf("color", "red"), classOf("display", "flex")].sort());
  });

  test("two blocks setting the SAME thing keep the later one, and only it", () => {
    expect(mergeClassNames(classOf("color", "red"), classOf("color", "blue"))).toBe(classOf("color", "blue"));
  });

  test("a falsy argument is a group that is switched off", () => {
    const base = classOf("display", "flex");
    const on = classOf("opacity", ".5");
    /** What `disabled && block` compiles to, with the condition where a condition really is. */
    const when = (condition: boolean) => mergeClassNames(base, condition && on);

    expect(when(false)).toBe(base);
    expect(when(true).split(" ")).toHaveLength(2);
    expect(mergeClassNames(base, undefined, null)).toBe(base);
  });

  test("and no arguments at all is a value that styles nothing", () => {
    expect(mergeClassNames()).toBe("");
  });

  /** A `match` that named no arm gives nothing back, which is the same answer as `if ({false})`. */
  test("a part that is `undefined` leaves what was above it standing", () => {
    expect(mergeClassNames(classOf("color", "red"), undefined)).toBe(classOf("color", "red"));
  });

  /**
   * **Two merges with the same contents are the same string**, which is what replaced the one-slot
   * cache the old value needed. A block written in the markup used to hand a child a new object on
   * every render; it hands it an equal string now, compared the way every other prop is compared.
   */
  test("the same contents are the same value, which is what identity used to cost a cache", () => {
    const once = mergeClassNames(classOf("color", "red"), classOf("padding", "8px"));
    const again = mergeClassNames(classOf("color", "red"), classOf("padding", "8px"));

    expect(again).toBe(once);
  });

  test("and the order the classes come out in is the order they were composed", () => {
    expect(mergeClassNames(classOf("display", "flex"), classOf("color", "red"))).toBe(
      `${classOf("display", "flex")} ${classOf("color", "red")}`,
    );
  });

  /** A key set twice moves to where it was set LAST, which is what "later wins" means for order. */
  test("a key set twice moves to where it was set last", () => {
    const out = mergeClassNames(classOf("color", "red"), classOf("display", "flex"), classOf("color", "blue"));

    expect(out).toBe(`${classOf("display", "flex")} ${classOf("color", "blue")}`);
  });
});

/**
 * A CLASS THIS COMPILER DID NOT WRITE, which is ordinary now that `className` is where a block goes.
 *
 * `mergeClassNames("lead", @@( … ))` is how a block sits beside a class of the author's own. `keyIn` reads a
 * key out of OUR spelling — everything between `r-` and the first `-` — and on a name that is not
 * ours it reads letters: measured, `lead` and `head` both come to `ad`, so one would have silently
 * displaced the other. A foreign class keys on itself.
 */
describe("a class this compiler did not write", () => {
  test("lands beside ours, in the order it was composed", () => {
    expect(mergeClassNames("lead", classOf("color", "red"))).toBe(`lead ${classOf("color", "red")}`);
  });

  test("and two that would have collided both survive", () => {
    expect(mergeClassNames("lead", "head").split(" ").sort()).toEqual(["head", "lead"]);
  });

  test("it displaces nothing of ours, and nothing of ours displaces it", () => {
    const out = mergeClassNames("lead", classOf("color", "red"), "head", classOf("color", "blue"));

    expect(out.split(" ").sort()).toEqual(["head", "lead", classOf("color", "blue")].sort());
  });

  test("a shorthand clears nothing that is not ours", () => {
    registerShorthand("padding");

    expect(mergeClassNames("pl", classOf("padding", "8px")).split(" ").sort()).toEqual(
      ["pl", classOf("padding", "8px")].sort(),
    );
  });

  test("and the same one twice is one class", () => {
    expect(mergeClassNames("lead", "lead")).toBe("lead");
  });
});

describe("a shorthand meeting its own longhand", () => {
  const PADDING = classOf("padding", "8px");
  const LEFT = classOf("padding-left", "40px");

  beforeEach(() => void registerShorthand("padding"));

  test("a later shorthand clears it, which is what CSS says", () => {
    expect(mergeClassNames(LEFT, PADDING)).toBe(PADDING);
  });

  test("an earlier one does not, because the sheet emits the longhand after it", () => {
    expect(mergeClassNames(PADDING, LEFT).split(" ").sort()).toEqual([LEFT, PADDING].sort());
  });

  test("the list itself never reaches the element", () => {
    expect(mergeClassNames(PADDING)).toBe(PADDING);
  });

  /**
   * **Associative**, which is what lets a nested `if` mean what a flattened one means — and it is
   * the property clearing could have broken, since clearing removes keys rather than replacing them.
   */
  test("and clearing is associative, which is what lets a group nest", () => {
    const other = classOf("padding-top", "4px");
    const flat = mergeClassNames(other, LEFT, PADDING);

    expect(mergeClassNames(other, mergeClassNames(LEFT, PADDING))).toBe(flat);
    expect(mergeClassNames(mergeClassNames(other, LEFT), PADDING)).toBe(flat);
    expect(mergeClassNames(mergeClassNames(mergeClassNames(other, LEFT), PADDING))).toBe(flat);
  });
});

/**
 * A clear-list is read through the KEY, which carries the context its declaration was written in.
 *
 * So `padding` inside a `@media` clears `padding-left` inside THAT `@media` and leaves the one
 * outside it alone — they are different declarations on different conditions and neither replaces
 * the other. The registration is keyed by the property alone and the context composes itself, which
 * is what lets one entry answer for every context a shorthand is written in.
 */
describe("clearing inside a condition", () => {
  const WIDE = ["@media (min-width: 40rem)"];

  beforeEach(() => void registerShorthand("padding"));

  test("clears only what shares its context", () => {
    const out = mergeClassNames(
      classOf("padding-left", "4px"),
      classOf("padding-left", "8px", { conditions: WIDE }),
      classOf("padding", "12px", { conditions: WIDE }),
    );

    expect(out.split(" ").sort()).toEqual(
      [classOf("padding-left", "4px"), classOf("padding", "12px", { conditions: WIDE })].sort(),
    );
  });

  /** A context that HASHED is still one context, because the hash is a function of its text. */
  test("and a hashed context clears within itself, which is the case a media query is", () => {
    expect(keyToken({ property: "padding", selector: "", conditions: WIDE }).startsWith("0")).toBe(true);
    expect(
      mergeClassNames(
        classOf("padding-left", "8px", { conditions: WIDE }),
        classOf("padding", "12px", { conditions: WIDE }),
      ),
    ).toBe(classOf("padding", "12px", { conditions: WIDE }));
  });

  test("and a readable one does too", () => {
    const PRINT = ["@media print"];

    expect(keyToken({ property: "padding", selector: "", conditions: PRINT })).toBe("@media_print.p");
    expect(
      mergeClassNames(
        classOf("padding-left", "8px", { conditions: PRINT }),
        classOf("padding", "12px", { conditions: PRINT }),
      ),
    ).toBe(classOf("padding", "12px", { conditions: PRINT }));
  });
});

/**
 * A block spread back into another — which is what `...{base};` does.
 *
 * `const base = @@( … )` compiles to a class string, and a spread hands `merge` that string. It used
 * to compile to a merged VALUE carrying a hidden map, and a value spread in without it composed
 * nothing: measured, a base spread into a modifier still produced a plausible class string, because
 * iterating a value's own keys happens to yield its `className` — so nothing could be overridden and
 * nothing cleared. There is nothing hidden to lose now.
 */
describe("a block spread back in", () => {
  const base = `${classOf("padding-left", "40px")} ${classOf("cursor", "pointer")}`;
  const roomy = classOf("padding", "8px");

  beforeEach(() => void registerShorthand("padding"));

  test("composes as the classes it is", () => {
    expect(mergeClassNames(base, roomy).split(" ").sort()).toEqual([classOf("cursor", "pointer"), roomy].sort());
  });

  test("and so does one that was merged already", () => {
    expect(mergeClassNames(mergeClassNames(base), roomy)).toBe(mergeClassNames(base, roomy));
  });

  test("which is the same answer as merging the parts directly", () => {
    expect(mergeClassNames(classOf("padding-left", "40px"), classOf("cursor", "pointer"), roomy)).toBe(
      mergeClassNames(base, roomy),
    );
  });
});

/**
 * **WHAT A SHORTHAND CLEARS, against the ENGINES rather than against our own table.**
 *
 * `SHORTHANDS` drives four things — the layer a rule lands in, the sheet's minor order, what a merge
 * clears, and what a module registers — so a wrong entry silently loses a style. The data used to
 * come from `mdn-data`'s `initial` field, which was patched by hand twice for exactly that fault and
 * was measured still missing **37** longhands after both patches. Five were verified end to end
 * against plain CSS in Chromium; `row-gap: 7px; grid-gap: 2px` gave 7px where CSS gives 2px.
 *
 * It comes from `leaves.generated.ts` now — Chromium, Firefox and WebKit, asked directly.
 */
describe("a logical shorthand clears its own side and nothing else", () => {
  const clears = (shorthand: string) => SHORTHANDS[shorthand] ?? [];

  test.each(["border-block-start", "border-block-end", "border-inline-start", "border-inline-end"])(
    "%s does not name `color`",
    (shorthand) => {
      expect(clears(shorthand)).not.toContain("color");
    },
  );

  /**
   * Its own side, plus any OTHER NAME for the same property — which is a browser's old spelling.
   *
   * Measured — they are one property under two names:
   *
   *     border-block-start: 7px solid rgb(1,2,3)  ->  -webkit-border-before reads it back
   *     -webkit-border-before: initial            ->  border-block-start becomes `initial`
   *
   * So not clearing it would leave two classes for one property with the sheet breaking the tie.
   * What the claim really is: nothing from ANOTHER side.
   */
  test.each(["border-block-start", "border-block-end", "border-inline-start", "border-inline-end"])(
    "%s names nothing from another side",
    (shorthand) => {
      const side = shorthand.replace("border-", "");
      const others = ["block-start", "block-end", "inline-start", "inline-end", "top", "bottom", "left", "right"]
        .filter((one) => one !== side)
        .map((one) => `border-${one}`);

      for (const one of clears(shorthand)) {
        expect(
          others.some((other) => one === other || one.startsWith(`${other}-`)),
          `${shorthand} clears ${one}`,
        ).toBe(false);
      }
      // And its own three leaves are there, which is what it is FOR.
      for (const part of ["color", "style", "width"]) expect(clears(shorthand)).toContain(`${shorthand}-${part}`);
    },
  );

  /** The physical side, which was never wrong, and the corner family, whose names are its own. */
  test("`border-top` is unchanged, and a corner still names the corners it sets", () => {
    expect([...clears("border-top")].sort()).toEqual(
      ["border-top-color", "border-top-style", "border-top-width"].sort(),
    );
    expect([...clears("corner-block-end-shape")].sort()).toEqual(
      ["corner-end-end-shape", "corner-end-start-shape"].sort(),
    );
  });

  /** And the same fact through the runtime, which is where a wrong list is a class deleted. */
  test("`color` survives a `border-block-start` beside it", () => {
    registerShorthand("border-block-start");

    expect(mergeClassNames(classOf("color", "red"), classOf("border-block-start", "1px")).split(" ").sort()).toEqual(
      [classOf("border-block-start", "1px"), classOf("color", "red")].sort(),
    );
  });

  test("and its own longhand does not", () => {
    registerShorthand("border-block-start");

    expect(mergeClassNames(classOf("border-block-start-width", "1px"), classOf("border-block-start", "2px"))).toBe(
      classOf("border-block-start", "2px"),
    );
  });
});

/**
 * A FOUR-SIDE SHORTHAND CLEARS THE LOGICAL SPELLINGS TOO, and that direction alone.
 *
 * The two families share no longhand — one is written in `margin-left`, the other in
 * `margin-inline-start` — so a subset of leaves saw nothing in common and the merge cleared
 * neither. Measured in Chromium against plain CSS: `margin-inline: 8px; margin: 0px` left both
 * classes on the element, and `margin-inline` won a declaration `margin` had replaced.
 *
 * **It is one-way, because only one way is true in every writing mode.** `margin` sets all four
 * sides, so it covers whichever pair `margin-inline` turns out to be. The reverse is the writing
 * mode's to decide — measured, `margin-left: 4px; margin-inline: 8px` is `margin-inline` on both
 * sides in `horizontal-tb` and `margin-left` surviving in `vertical-rl` — so nothing is cleared and
 * `override-out-of-order` reports the pair instead.
 */
describe("a four-side shorthand meeting a logical one", () => {
  const clears = (name: string) => new Set(SHORTHANDS[name] ?? []);

  test.each([
    ["margin", "margin-inline"],
    ["margin", "margin-block-start"],
    ["padding", "padding-inline"],
    ["inset", "inset-inline-end"],
    ["border-width", "border-inline-width"],
    ["border-radius", "border-start-start-radius"],
    ["scroll-padding", "scroll-padding-block"],
  ])("`%s` clears `%s`", (broad, logical) => {
    expect(clears(broad).has(logical)).toBe(true);
  });

  test.each([
    ["margin-inline", "margin-left"],
    ["margin-block", "margin-top"],
    ["padding-inline", "padding-left"],
    ["inset-inline", "left"],
  ])("`%s` does NOT clear `%s`, because only the writing mode knows", (logical, physical) => {
    expect(clears(logical).has(physical)).toBe(false);
  });

  test("and the runtime does what the table says", () => {
    registerShorthand("margin-inline");
    registerShorthand("margin");

    expect(mergeClassNames(classOf("margin-inline", "8px"), classOf("margin", "0px"))).toBe(classOf("margin", "0px"));
    // The other order keeps both: `margin` cannot clear what is written after it, and the sheet
    // emits it first, so `margin-inline` wins — which is what plain CSS does too.
    expect(mergeClassNames(classOf("margin", "0px"), classOf("margin-inline", "8px")).split(" ").sort()).toEqual(
      [classOf("margin", "0px"), classOf("margin-inline", "8px")].sort(),
    );
  });

  /**
   * `border-inline-width` is a SHORTHAND that `mdn-data` does not know is one — its `initial` is
   * `"medium"`, the initial value, where every other shorthand's is a list of longhands.
   */
  test.each([
    "border-block-color",
    "border-block-style",
    "border-block-width",
    "border-inline-color",
    "border-inline-style",
    "border-inline-width",
  ])("`%s` is read as the shorthand it is", (name) => {
    expect(clears(name).size).toBeGreaterThan(0);
  });
});

describe("a shorthand clears what a browser resets", () => {
  test.each([
    ["the longhand a shorthand's `initial` field forgot", "row-gap", "grid-gap"],
    ["a border image, which `border` resets", "border-image-source", "border"],
    ["a decoration's thickness", "text-decoration-thickness", "text-decoration"],
    ["a background position axis", "background-position-x", "background"],
    ["a logical border's colour", "border-inline-start-color", "border-inline"],
  ])("%s", (_what, longhand, shorthand) => {
    const cleared = registerShorthand(shorthand);

    expect(cleared, `${shorthand} is not in the table at all`).toBeDefined();
    expect(cleared, `${shorthand} does not clear ${longhand}`).toContain(longhand);

    // And the merge keeps only the shorthand, which is what clearing MEANS at the call site.
    expect(mergeClassNames(classOf(longhand, "a"), classOf(shorthand, "b"))).toBe(classOf(shorthand, "b"));
  });

  /**
   * And the direction that would DELETE the author's work: a longhand a browser keeps must not be
   * cleared. Measured across all 98 shorthands and every leaf: zero.
   */
  test("and nothing a browser keeps is cleared", () => {
    // `border-radius` and `border-width` are different families — neither resets the other.
    expect(SHORTHANDS["border-radius"] ?? []).not.toContain("border-top-width");
    expect(SHORTHANDS["border-width"] ?? []).not.toContain("border-top-left-radius");
    // A longhand clears nothing at all, whatever it is called.
    expect(SHORTHANDS["margin-top"]).toBeUndefined();
    expect(SHORTHANDS.color).toBeUndefined();
  });
});

describe("an override the stylesheet will not honour", () => {
  const said: string[] = [];
  const real = console.warn;

  beforeEach(() => {
    said.length = 0;
    console.warn = (message: string) => said.push(message);
  });
  afterEach(() => {
    console.warn = real;
  });

  /** A declaration under a condition, with what a module registers for it. */
  const under = (condition: string, property: string, value: string) => {
    registerConditions(property, [condition]);
    registerName(property);
    return classOf(property, value, { conditions: [condition] });
  };

  test("a mode composed after a breakpoint cannot override it, and is reported", () => {
    mergeClassNames(
      under("@media (min-width: 40rem)", "color", "wide"),
      under("@media (prefers-color-scheme: dark)", "color", "dark"),
    );

    expect(said).toHaveLength(1);
    expect(said[0]).toContain("`color`");
    expect(said[0]).toContain("prefers-color-scheme");
    expect(said[0]).toContain("min-width: 40rem");
  });

  test("and the way round the stylesheet does honour is silent", () => {
    mergeClassNames(
      under("@media (prefers-color-scheme: dark)", "color", "dark"),
      under("@media (min-width: 40rem)", "color", "wide"),
    );

    expect(said).toEqual([]);
  });

  test("two breakpoints, the wider one composed later, is silent", () => {
    mergeClassNames(
      under("@media (min-width: 40rem)", "color", "narrow"),
      under("@media (min-width: 64rem)", "color", "wide"),
    );

    expect(said).toEqual([]);
  });

  test("and the narrower one composed later is reported", () => {
    mergeClassNames(
      under("@media (min-width: 64rem)", "color", "wide"),
      under("@media (min-width: 40rem)", "color", "narrow"),
    );

    expect(said).toHaveLength(1);
  });

  /**
   * A SELECTOR settles it by specificity, not by the sheet — so comparing the pair would report
   * correct CSS, which is the failure mode this package has already paid for. A module registers
   * nothing for a key with a selector, so the pair is never comparable.
   */
  test("a selector against a condition is not compared at all", () => {
    mergeClassNames(
      under("@media (min-width: 40rem)", "color", "wide"),
      classOf("color", "hover", { selector: "&:hover" }),
    );

    expect(said).toEqual([]);
  });

  test("two properties that do not fight are not compared", () => {
    mergeClassNames(
      under("@media (min-width: 40rem)", "color", "wide"),
      under("@media (prefers-color-scheme: dark)", "background-color", "dark"),
    );

    expect(said).toEqual([]);
  });

  /** One block on its own is the compiler's to report, at the author's line. */
  test("a single block is not checked here at all", () => {
    const wide = under("@media (min-width: 40rem)", "color", "wide");
    const dark = under("@media (prefers-color-scheme: dark)", "color", "dark");

    mergeClassNames(`${wide} ${dark}`);

    expect(said).toEqual([]);
  });

  test("and it is said once, however many times the same thing is composed", () => {
    for (let index = 0; index < 5; index++) {
      mergeClassNames(
        under("@media (min-width: 40rem)", "color", "wide"),
        under("@media (prefers-color-scheme: dark)", "color", "dark"),
      );
    }

    expect(said).toHaveLength(1);
  });
});

/**
 * **THE WARNING MISSED EVERY SHORTHAND, and that is all 98 families.**
 *
 * `warnAboutOrder` exists for the one hole the compiler cannot see: `...{base}` is a runtime value,
 * so nothing at build time knows what is in it. It grouped by the EXACT property name, so
 * `padding` and `padding-left` were never compared — and a shorthand under a condition silently beat
 * a longhand composed after it.
 *
 * Measured against plain CSS in Chromium, over 425 compositions of 21 blocks: 406 agreed, 17
 * disagreed AND warned (the documented cross-condition answer), and **2 disagreed with nothing
 * said** — both this shape:
 *
 *     ...{@media (min-width: 1px) { padding: 11px }};  padding-left: 4px
 *         ours 11px        plain CSS 4px
 *
 * Then swept across the whole table: **98 shorthand families asked, 0 warned, 98 silent.**
 *
 * The clear-list is what answers it, for the same reason it does the clearing: a shorthand's
 * registration IS the list of longhands it sets.
 */
describe("a shorthand composed under a condition", () => {
  const spoke: string[] = [];
  let real: typeof console.warn;

  beforeEach(() => {
    spoke.length = 0;
    real = console.warn;
    console.warn = (...args: unknown[]) => void spoke.push(args.map(String).join(" "));
  });
  afterEach(() => {
    console.warn = real;
  });

  /** A conditional shorthand, registered the way the emitted module registers one. */
  const conditional = (condition: string, shorthand: string) => {
    registerShorthand(shorthand);
    registerConditions(shorthand, [condition]);
    return classOf(shorthand, "a", { conditions: [condition] });
  };

  beforeEach(() => void registerName("padding-left"));

  test("warns when a longhand it sets is composed after it", () => {
    const out = mergeClassNames(conditional("@media (min-width: 1px)", "padding"), classOf("padding-left", "4px"));

    expect(spoke).toHaveLength(1);
    expect(spoke[0]).toContain("padding-left");
    expect(spoke[0]).toContain("padding");
    // Both classes land, because neither clears the other across a condition.
    expect(out.split(" ")).toHaveLength(2);
  });

  test("and names both properties, because they are not the same one", () => {
    mergeClassNames(conditional("@media print", "border"), classOf("border-left-color", "red"));

    expect(spoke[0]).toContain("border-left-color");
    expect(spoke[0]).toContain("border");
    expect(spoke[0]).toContain("@media print");
  });

  /** The other way round is fine: the stronger condition IS last, so it wins as written. */
  test("says nothing when the conditional shorthand is composed last", () => {
    mergeClassNames(classOf("padding-left", "4px"), conditional("@media (min-width: 1px)", "padding"));

    expect(spoke).toEqual([]);
  });

  /**
   * And nothing under ONE condition, where the layer order already settles it: a longhand's breadth
   * puts it after its shorthand, so composing it later is exactly what happens.
   */
  test("says nothing with no condition at all", () => {
    registerShorthand("padding");

    mergeClassNames(classOf("padding", "8px"), classOf("padding-left", "4px"));

    expect(spoke).toEqual([]);
  });

  test("says nothing with one condition, on both", () => {
    const conditions = ["@media (min-width: 1px)"];
    registerShorthand("padding");
    registerConditions("padding", conditions);
    registerConditions("padding-left", conditions);

    mergeClassNames(classOf("padding", "8px", { conditions }), classOf("padding-left", "4px", { conditions }));

    expect(spoke).toEqual([]);
  });

  /** A property outside the shorthand's family is not its business. */
  test("says nothing about an unrelated property", () => {
    mergeClassNames(conditional("@media (min-width: 1px)", "padding"), classOf("color", "red"));

    expect(spoke).toEqual([]);
  });

  /** And it stays silent in production, which is what the whole warning costs there: nothing. */
  test("says nothing in production", () => {
    const was = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      mergeClassNames(conditional("@media (min-width: 1px)", "padding"), classOf("padding-left", "4px"));
      expect(spoke).toEqual([]);
    } finally {
      process.env.NODE_ENV = was;
    }
  });
});

describe("a package built by an older release", () => {
  /**
   * A published package is frozen: what its module registers is the table of the release that built
   * it. When CSS adds a longhand to a family, that list does not have it, and the page's merge must
   * still clear it — so the merge carries the table of the release the APPLICATION runs.
   *
   * Measured in all three engines before this existed: `border-top-color: red` written first, an old
   * package's `border: var(--x)` written later, and the page showed red where CSS shows the border.
   */
  test("a shorthand clears a longhand its own module never registered", () => {
    const longhand = classOf("border-top-color", "red");
    const whole = classOf("border", "var(--x)");
    const old = (SHORTHANDS.border ?? []).map(writableProperty).filter((one) => one !== "border_top_color");
    shorthands({ [writableProperty("border") ?? ""]: old as string[] });

    expect(mergeClassNames(longhand, whole)).toBe(whole);
  });

  test("and with nothing registered at all", () => {
    const longhand = classOf("padding-left", "4px");
    const whole = classOf("padding", "var(--p)");

    expect(mergeClassNames(longhand, whole)).toBe(whole);
  });
});

describe("the table the merge carries", () => {
  /**
   * Written by `build-clears-table.mjs` with each family's DIRECT members and braces, so what the
   * merge reads back is not the generated shorthand table — and a mistake in either half, the
   * writing or the reading, would only show here. Every family, and every property any family
   * names: a family clears exactly its own members, and every other class survives.
   */
  test("every shorthand clears exactly what CSS says it covers", () => {
    const universe = [...new Set([...Object.keys(SHORTHANDS), ...Object.values(SHORTHANDS).flat()])].filter(
      (one) => writableProperty(one) !== undefined,
    );
    const wrong: string[] = [];
    for (const [family, members] of Object.entries(SHORTHANDS)) {
      if (writableProperty(family) === undefined || members.some((one) => writableProperty(one) === undefined))
        continue;
      // Merged once on their own first, because shorthands among them clear each other.
      const before = String(
        mergeClassNames(
          universe
            .filter((one) => one !== family)
            .map((one) => classOf(one, "x"))
            .join(" "),
        ),
      );
      const cleared = new Set(members.map((one) => classOf(one, "x")));
      const expected = [...before.split(" ").filter((one) => !cleared.has(one)), classOf(family, "x")];
      if (mergeClassNames(before, classOf(family, "x")) !== expected.join(" ")) wrong.push(family);
    }
    expect(wrong).toEqual([]);
  });
});

/**
 * `narrower-after-a-whole-shorthand`, for what the compiler cannot see: two blocks, composed.
 *
 * Inside one block the compiler refuses it. Across blocks only the merge holds both, so it says so in
 * development. A class is whole when its key is a shorthand's and it is not a split's marker.
 */
describe("a narrower shorthand composed after a whole one", () => {
  const said: string[] = [];
  const real = console.warn;
  beforeEach(() => {
    said.length = 0;
    console.warn = (message: string) => void said.push(message);
  });
  afterEach(() => {
    console.warn = real;
  });

  const border = classOf("border", "var(--x)");
  const top = classOf("border-top", "var(--y)");

  test("is said, once, naming both classes", () => {
    mergeClassNames(border, top);
    mergeClassNames(border, top);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(border);
    expect(said[0]).toContain(top);
  });

  test("and not the other way round, which the merge settles by clearing", () => {
    expect(mergeClassNames(top, border)).toBe(border);
    expect(said).toEqual([]);
  });

  test("nor for a longhand or a split after it, which are stronger", () => {
    mergeClassNames(border, classOf("border-top-color", "red"));
    mergeClassNames(border, `r-bt- ${classOf("border-top-color", "red")}`);
    expect(said).toEqual([]);
  });

  test("and for a wider one without a var(), since it reached the sheet whole too", () => {
    mergeClassNames(classOf("font", "caption"), classOf("font-variant", "var(--v)"));
    expect(said).toHaveLength(1);
  });

  test("and whatever the value is spelt as — a hashed one has no var( in it to read", () => {
    mergeClassNames(classOf("border", "Qb0fRLj5j"), classOf("border-top", "Zk3pWq8mN"));
    expect(said).toHaveLength(1);
  });
});
