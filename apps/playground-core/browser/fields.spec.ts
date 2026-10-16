import { expect, test } from "@playwright/test";

/**
 * Two things about a field that jsdom cannot settle, because both are the browser's own.
 *
 * - **A word typed through an input method.** Chromium sends no ordinary `input` after a
 *   composition — its last `input` still says `isComposing` — so a handler that skips composing
 *   input never took the word, and core sends that `input` itself (`forwarded.ts`, "When it ends").
 *   The composition is driven through the DevTools protocol's IME, which goes through the same path
 *   a real input method does. Firefox, which sends the `input` itself, is checked by
 *   `firefox-composition.mjs`: Playwright cannot compose in it.
 * - **A form's reset.** It returns a select to the option whose `selected` ATTRIBUTE is set, which is
 *   where `Select` writes its `defaultValue`. jsdom was measured to move a choice where browsers do
 *   not, so this is asked of a browser.
 */
test.describe("fields only a browser settles", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/fields");
  });

  /** Types 日本 the way a Japanese input method does: `n`, `に`, then the committed word. */
  async function compose(page: import("@playwright/test").Page, selector: string) {
    await page.locator(selector).click();
    const session = await page.context().newCDPSession(page);
    for (const text of ["n", "に"]) {
      await session.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    }
    await session.send("Input.insertText", { text: "日本" });
  }

  test("a handler that skips composing input takes the word, once", async ({ page }) => {
    await compose(page, "#skips");
    await expect(page.locator("#skips-taken")).toHaveText('["日本"]');
    await expect(page.locator("#skips")).toHaveValue("日本");
  });

  /** It had the word from the last composing `input`, so core sends nothing more. */
  test("a handler that takes every input is not called again for the word", async ({ page }) => {
    await compose(page, "#takes");
    await expect(page.locator("#takes-taken")).toHaveText('["n","に","日本"]');
    await expect(page.locator("#takes")).toHaveValue("日本");
  });

  test("a form's reset returns a defaultValue select to its default", async ({ page }) => {
    const size = page.locator("#size");
    await expect(size).toHaveValue("m");
    await size.selectOption("l");
    await expect(size).toHaveValue("l");
    await page.locator("#reset").click();
    await expect(size).toHaveValue("m");
  });
});
