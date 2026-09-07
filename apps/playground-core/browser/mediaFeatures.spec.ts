import { expect, test } from "@playwright/test";
import { MEDIA_FEATURES } from "@ramonda/css/compiler";

/**
 * Every `@media` feature name the checker knows, asked of a real browser.
 *
 * The table in `keywords.generated.ts` is WRITTEN DOWN, and it is the only table in that file that
 * is: `mdn-data` gives `@media` no descriptors and its grammar bottoms out at `mf-name: <ident>`.
 * Every other table there is asserted against mdn-data's own so a typo cannot sit in it, and this
 * one has nothing to be asserted against — except a browser.
 *
 * ## The oracle, and why the obvious one is not it
 *
 * A stylesheet parse says nothing. Measured in Chromium: `@media (nonsense)` and even
 * `@media (min-width 40rem)` survive in `cssRules` with their text intact, because an unknown
 * feature is `<general-enclosed>` — legal CSS that never matches. `matchMedia(…).media` echoes the
 * text back for the same reason.
 *
 * What DOES separate them is the negation. For a feature the browser knows, exactly one of `(f)`
 * and `not (f)` holds. For one it does not know, both are false — the query never matches, and
 * neither does its negation. That is the whole test.
 *
 * A name that fails here is either a typo in the table or a feature this browser has not shipped;
 * the message says which to check, because they are fixed differently.
 */
test.describe("the media features the checker knows", () => {
  test("every one of them is a feature this browser recognises", async ({ page }) => {
    await page.goto("/");

    const unknown = await page.evaluate((features: readonly string[]) => {
      /**
       * A value each feature accepts, so the query is well formed for the ones that need one.
       *
       * A feature asked with a value it does not take reads exactly like a feature that does not
       * exist — measured, `(min-resolution: 0)` is as unknown to the browser as `(nonsense)` is,
       * because a resolution needs a unit. So the values here are part of the probe rather than
       * decoration, and getting one wrong reports a real feature as missing.
       */
      const VALUES: Record<string, string> = {
        resolution: "1dppx",
        "dynamic-range": "standard",
        "video-dynamic-range": "standard",
        "inverted-colors": "none",
        "prefers-reduced-data": "no-preference",
        "color-gamut": "srgb",
        "display-mode": "browser",
        "forced-colors": "none",
        "overflow-block": "scroll",
        "overflow-inline": "scroll",
        scripting: "enabled",
        update: "fast",
      };

      const value = (feature: string): string => {
        const bare = feature.replace(/^(min|max)-/, "");
        const given = VALUES[bare];
        if (given !== undefined) return `: ${given}`;
        if (/^(min|max)-/.test(feature)) return feature.includes("ratio") ? ": 1/1" : ": 0";
        return "";
      };

      return features.filter((feature) => {
        const query = `(${feature}${value(feature)})`;
        // Exactly one of the two holds for a feature the browser knows.
        return matchMedia(query).matches === matchMedia(`not ${query}`).matches;
      });
    }, MEDIA_FEATURES);

    /**
     * Real features this browser has not shipped, each named rather than tolerated in bulk.
     *
     * The checker's table is what CSS has, not what Chromium has, so a feature another engine
     * implements belongs in it — an author writing `(inverted-colors: inverted)` is right, and
     * reporting them as typos would be the false report this whole rule is shaped to avoid.
     *
     * Listing them one by one is what keeps the test worth running: a NEW name that fails here is
     * a typo until somebody adds it below with a reason.
     */
    const notInChromium = [
      // Safari and Firefox; Chromium has never implemented it.
      "inverted-colors",
      // Behind a flag in Chromium, and shipped nowhere by default at the time of writing.
      "prefers-reduced-data",
      // Safari only.
      "video-dynamic-range",
    ];

    expect(
      unknown.filter((one) => !notInChromium.includes(one)),
      "a name here is either a typo in MEDIA_FEATURES or a feature this browser has not shipped — " +
        "check the spelling first, and only then add it to `notInChromium` with the reason",
    ).toEqual([]);

    // And the exemptions are not allowed to rot: one this browser has since shipped must come off.
    expect(notInChromium.filter((one) => !unknown.includes(one))).toEqual([]);
  });

  /** The oracle itself, so a change that quietly stops separating the two is caught here. */
  test("and a name it does not know is separable from one it does", async ({ page }) => {
    await page.goto("/");

    expect(
      await page.evaluate(() => {
        const known = (query: string) => matchMedia(query).matches !== matchMedia(`not ${query}`).matches;
        return { real: known("(hover)"), invented: known("(nonsense)"), typo: known("(min-widht: 0)") };
      }),
    ).toEqual({ real: true, invented: false, typo: false });
  });
});
