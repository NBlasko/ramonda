import { describe, expect, test } from "vitest";
import { explain, ruleFor } from "../codegen";
import type { PropertyRules } from "../config";
import { PRIMITIVE } from "../compiler/keywords.generated";

/**
 * `explain` — which selector decided each setting for one property.
 *
 * The config is keyed by three things now and each binds more tightly than the one before, so
 * knowing what applies to `border-radius` means reading three entries and holding CSS's own
 * classification in your head. The user's words, twice over: *"sada imam samo jos jedno pitanje jer
 * smo toliko ukomplikovali da mi je tesko da pratim."*
 *
 * **It must not be a second opinion.** `ruleFor` is what codegen and the rules actually read, and an
 * explanation that agreed with it by accident would be worse than none — it would be believed. So
 * the test below is not about formatting: it asserts that what `explain` reports, flattened, IS
 * `ruleFor`'s answer, over every property CSS has.
 */
describe("explain", () => {
  const RULES: PropertyRules = {
    "*": { shorthand: false, arity: 1 },
    "<length>": { variablesOnly: true, units: ["px", "rem"] },
    "border-radius": { variablesOnly: false },
    "z-index": { values: [0, 1, 10] },
  };

  const settingsOf = (property: string) =>
    Object.fromEntries(explain(RULES, property).settings.map((one) => [one.name, one.value]));

  test("a setting from the sweep says so", () => {
    const [arity] = explain(RULES, "padding-left").settings.filter((one) => one.name === "arity");

    expect(arity.from).toBe("*");
  });

  test("one from the kind says which kind", () => {
    const [only] = explain(RULES, "padding-left").settings.filter((one) => one.name === "variablesOnly");

    expect(only.from).toBe("<length>");
    expect(only.value).toBe(true);
  });

  test("and a property overriding its kind says both", () => {
    const [only] = explain(RULES, "border-radius").settings.filter((one) => one.name === "variablesOnly");

    expect(only.from).toBe("border-radius");
    expect(only.value).toBe(false);
    expect(only.overriding).toBe("<length>");
  });

  test("a property no kind reaches gets the sweep, and only the sweep", () => {
    expect(settingsOf("content")).toEqual({ shorthand: false, arity: 1 });
    expect(explain(RULES, "content").settings.every((one) => one.from === "*")).toBe(true);
  });

  test("the kind is reported, because it is what a `<kind>` selector matches on", () => {
    expect(explain(RULES, "padding-left").kind).toBe("length-percentage");
    expect(explain(RULES, "content").kind).toBeUndefined();
  });

  test("a property that is not one is said to be not one", () => {
    expect(explain(RULES, "pading-left").known).toBe(false);
    expect(explain(RULES, "padding-left").known).toBe(true);
  });

  /**
   * The guard that matters: an explanation that drifts from what is enforced would be believed.
   * Asked of EVERY property, because the drift would appear in whichever one nobody checked.
   */
  test("what it reports IS what `ruleFor` decided, for every property CSS has", () => {
    for (const property of Object.keys(PRIMITIVE)) {
      const flattened = Object.fromEntries(explain(RULES, property).settings.map((one) => [one.name, one.value]));
      const enforced = Object.fromEntries(Object.entries(ruleFor(RULES, property)).filter(([, v]) => v !== undefined));

      expect({ property, ...flattened }).toEqual({ property, ...enforced });
    }
  });

  test("and with no config at all, there is nothing to explain and it says so", () => {
    const nothing = explain(undefined, "padding-left");

    expect(nothing.settings).toEqual([]);
    expect(nothing.known).toBe(true);
  });
});
