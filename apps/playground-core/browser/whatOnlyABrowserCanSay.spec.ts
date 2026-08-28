import { expect, test } from "@playwright/test";

/**
 * Three claims that jsdom agreed with and could not settle.
 *
 * Each was fixed against a jsdom test first, and each needed somebody at a keyboard before it could
 * be believed. The third is here because its jsdom test passed while the behaviour in a browser was
 * the opposite — not through any fault in the fix, but because the demo measured the wrong thing:
 * pressing a button takes the focus, so by the time the rows moved there was nothing in the list
 * left to keep. No amount of jsdom would have shown that.
 *
 * Every field is typed into rather than filled: typing produces the same key and input events a
 * person does, and the caret is what those events move.
 */
test.describe("what only a browser can say", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/caret");
  });

  /**
   * A model that rewrites in place — uppercasing — leaves the caret where the reader put it.
   *
   * The second typed character is the assertion. Where the caret is dropped, it lands after every
   * letter that was already there; where it is kept, it lands beside its neighbour.
   */
  test("the caret stays put when the model rewrites in place", async ({ page }) => {
    const field = page.locator("#upper");
    await field.click();
    await field.press("Home");
    await field.press("ArrowRight");

    await field.pressSequentially("xy");

    // `ABCDEF` typed into after the first letter, with the Y beside the X rather than at the end.
    await expect(field).toHaveValue("AXYBCDEF");
  });

  /**
   * And the boundary that is deliberately NOT fixed, asserted so the browser agrees on it too.
   *
   * A rewrite that changes the length moves every offset after it, so there is no position to
   * restore that would still mean the same place. The caret is left where the platform put it — at
   * the end — rather than somewhere guessed, and an app that formats places it itself.
   */
  test("a rewrite that changes the length leaves the caret at the end", async ({ page }) => {
    const field = page.locator("#money");
    await field.click();
    await field.press("Home");
    await field.press("ArrowRight");

    // Typed in the MIDDLE: `1234567` becomes `19234567`, which the model groups into ten characters.
    await field.pressSequentially("9");

    await expect(field).toHaveValue("19,234,567");
    const caret = await field.evaluate((node: HTMLInputElement) => node.selectionStart);
    const length = await field.evaluate((node: HTMLInputElement) => node.value.length);
    expect(caret).toBe(length);
  });

  /**
   * Focus across a reorder, and the reason this suite exists.
   *
   * Moving a row means removing its node and putting it back, and a removed node is blurred —
   * everything else about it survives, so the only sign is that typing quietly stops arriving. The
   * rows rotate on a timer here, and the button that starts the timer prevents its own mousedown, so
   * nothing takes the focus away and the field is still the thing being typed into when the list
   * moves under it.
   */
  test("a row keeps the reader in it while the list moves underneath", async ({ page }) => {
    const field = page.locator("#row-a");
    await field.click();
    await field.pressSequentially("hel");

    await page.getByRole("button", { name: "Rotate every 1.5s" }).click();
    // The button gave the focus straight back; if it had not, the rest would measure nothing.
    await expect(field).toBeFocused();

    // Two rotations, with the keyboard typed into whatever holds the focus rather than into a
    // locator — which is the whole question: does anything still hold it?
    await page.waitForTimeout(1700);
    await page.keyboard.type("lo");
    await page.waitForTimeout(1700);
    await page.keyboard.type("!");

    await expect(field).toHaveValue("hello!");
    await expect(field).toBeFocused();
  });
});
