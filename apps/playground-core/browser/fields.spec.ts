import { expect, test } from "@playwright/test";

/**
 * What a field does that jsdom cannot settle, because it is the browser's own.
 *
 * - **A word typed through an input method.** Chromium sends no ordinary `input` after a
 *   composition — its last `input` still says `isComposing` — so a handler that skips composing
 *   input would never take the word; the field hands it over at `compositionend` (`field.ts`, "When
 *   it ends"), on a `TextArea` and on an `<input>` alike. The composition is driven through the
 *   DevTools protocol's IME, which goes through the same path a real input method does. Firefox,
 *   which sends that `input` itself, is checked by `firefox-composition.mjs`: Playwright cannot
 *   compose in it.
 * - **A form's reset.** It returns a select to the option whose `selected` ATTRIBUTE is set, which is
 *   where `Select` writes its `defaultValue`. jsdom was measured to move a choice where browsers do
 *   not, so this is asked of a browser.
 * - **What is drawn.** A refused pick or keystroke is gone in the event that made it — by the field's
 *   `transform`, or by its own handler, which the field answers at once. Chromium draws a frame
 *   between an event and a timer, so an answer a task later was measured to show the refused pick in
 *   100 tries of 100; jsdom draws nothing, so this is asked of a browser.
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

  for (const [suffix, on] of [
    ["", "a TextArea"],
    ["-input", "an <input>"],
  ]) {
    test(`a handler that skips composing input takes the word, once — on ${on}`, async ({ page }) => {
      await compose(page, `#skips${suffix}`);
      await expect(page.locator(`#skips${suffix}-taken`)).toHaveText('["日本"]');
      await expect(page.locator(`#skips${suffix}`)).toHaveValue("日本");
    });

    /** It had the word from the last composing `input`, so the field hands over nothing more. */
    test(`a handler that takes every input is not called again for the word — on ${on}`, async ({ page }) => {
      await compose(page, `#takes${suffix}`);
      await expect(page.locator(`#takes${suffix}-taken`)).toHaveText('["n","に","日本"]');
      await expect(page.locator(`#takes${suffix}`)).toHaveValue("日本");
    });
  }

  /**
   * A render between the listeners of one event — the form around the fields flips its "Save" button
   * on every `input` — does not write an old value back: each field's model is its own handler's by
   * then, the select's included, whose `change` comes after that render.
   */
  test("a render in the middle of an event keeps what the user did", async ({ page }) => {
    await page.locator("#between-text").pressSequentially("abc");
    await page.locator("#between-size").selectOption("l");
    await expect(page.locator("#between-model")).toHaveText('{"text":"abc","size":"l"}');
    await expect(page.locator("#between-text")).toHaveValue("abc");
    await expect(page.locator("#between-size")).toHaveValue("l");
  });

  test("a form's reset returns a defaultValue select to its default", async ({ page }) => {
    const size = page.locator("#size");
    await expect(size).toHaveValue("m");
    await size.selectOption("l");
    await expect(size).toHaveValue("l");
    await page.locator("#reset").click();
    await expect(size).toHaveValue("m");
  });

  /**
   * What each frame shows, read just before it is drawn: a `ResizeObserver` runs after every
   * animation-frame callback of the frame, so it sees what the answer left. A probe resized every
   * frame makes it run on each.
   */
  async function watchFrames(
    page: import("@playwright/test").Page,
    selector: string,
    read: "value" | "checked" = "value",
  ) {
    await page.evaluate(
      ([selector, read]) => {
        const field = document.querySelector(selector) as HTMLInputElement;
        const probe = document.body.appendChild(document.createElement("div"));
        probe.style.cssText = "width:1px;height:1px";
        const w = window as unknown as { drawn: string[] };
        w.drawn = [];
        new ResizeObserver(() => w.drawn.push(String(field[read]))).observe(probe);
        const tick = () => {
          probe.style.width = probe.style.width === "1px" ? "2px" : "1px";
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      [selector, read] as const,
    );
  }

  const drawn = (page: import("@playwright/test").Page) =>
    page.evaluate(() => (window as unknown as { drawn: string[] }).drawn);

  test("a refused pick is never drawn, and the form reads what the select keeps", async ({ page }) => {
    await watchFrames(page, "#refused-size");
    await page.locator("#refused-size").focus();
    // From m, ArrowDown is l — refused every time, so the select is back on m for the next one.
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(40);
    }
    await expect(page.locator("#refused-read")).toHaveText("m");
    await expect(page.locator("#refused-size")).toHaveValue("m");
    const frames = await drawn(page);
    expect(frames.length).toBeGreaterThan(20);
    expect(frames).not.toContain("l");
  });

  test("a refused keystroke is never drawn", async ({ page }) => {
    await watchFrames(page, "#refused-text");
    await page.locator("#refused-text").click();
    await page.keyboard.press("End");
    for (let i = 0; i < 20; i++) {
      await page.keyboard.type("d");
      await page.waitForTimeout(40);
    }
    await expect(page.locator("#refused-text")).toHaveValue("abc");
    const frames = await drawn(page);
    expect(frames.length).toBeGreaterThan(20);
    expect(frames.filter((value) => value.length > 3)).toEqual([]);
  });

  /** A handler that refuses on its own is answered in the same event, so its refusal is never drawn either. */
  test("a pick the handler refuses is never drawn", async ({ page }) => {
    await watchFrames(page, "#refused-by-hand");
    await page.locator("#refused-by-hand").focus();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(40);
    }
    await expect(page.locator("#refused-by-hand")).toHaveValue("m");
    const frames = await drawn(page);
    expect(frames.length).toBeGreaterThan(20);
    expect(frames).not.toContain("l");
  });

  for (const [id, by] of [
    ["refused-input", "its transform"],
    ["refused-input-by-hand", "its handler"],
  ]) {
    test(`a keystroke ${by} refuses is never drawn — on an <input>`, async ({ page }) => {
      await watchFrames(page, `#${id}`);
      await page.locator(`#${id}`).click();
      await page.keyboard.press("End");
      for (let i = 0; i < 20; i++) {
        await page.keyboard.type("d");
        await page.waitForTimeout(40);
      }
      await expect(page.locator(`#${id}`)).toHaveValue("abc");
      const frames = await drawn(page);
      expect(frames.length).toBeGreaterThan(20);
      expect(frames.filter((value) => value.length > 3)).toEqual([]);
    });
  }

  test("a box the handler will not tick is never drawn ticked", async ({ page }) => {
    await watchFrames(page, "#refused-box", "checked");
    for (let i = 0; i < 20; i++) {
      await page.locator("#refused-box").click();
      await page.waitForTimeout(40);
    }
    await expect(page.locator("#refused-box")).not.toBeChecked();
    const frames = await drawn(page);
    expect(frames.length).toBeGreaterThan(20);
    expect(frames).not.toContain("true");
  });

  /** The refused radio is put back with its group: `m` is on again, and `l` never shows on. */
  test("a radio the handler will not pick is never drawn picked, and the group keeps its own", async ({ page }) => {
    await watchFrames(page, "#radio-l", "checked");
    for (let i = 0; i < 20; i++) {
      await page.locator("#radio-l").click();
      await page.waitForTimeout(40);
    }
    await expect(page.locator("#radio-m")).toBeChecked();
    await expect(page.locator("#radio-l")).not.toBeChecked();
    await expect(page.locator("#refused-input-model")).toHaveText(
      '{"text":"abc","handled":"abc","ticked":false,"size":"m"}',
    );
    const frames = await drawn(page);
    expect(frames.length).toBeGreaterThan(20);
    expect(frames).not.toContain("true");
  });
});
