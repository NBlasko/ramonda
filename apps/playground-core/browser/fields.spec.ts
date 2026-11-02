import { expect, test } from "@playwright/test";

/**
 * What a field does that jsdom cannot settle, because it is the browser's own.
 *
 * - **A word typed through an input method.** Each step of the word reaches the handler; Chromium
 *   sends no ordinary `input` after a composition — its last `input` still says `isComposing` — so a
 *   handler that waits for the finished word is handed it at `compositionend` (`field.ts`, "When it
 *   ends"), once, on a `TextArea` and on an `<input>` alike. The composition is driven through the
 *   DevTools protocol's IME, which goes through the same path a real input method does. Firefox,
 *   which sends that `input` itself, is checked by `firefox-composition.mjs`: Playwright cannot
 *   compose in it.
 * - **A form's reset.** It returns a select to the option whose `selected` ATTRIBUTE is set, which is
 *   where `Select` writes its `defaultValue`. jsdom was measured to move a choice where browsers do
 *   not, so this is asked of a browser.
 * - **A number not typed yet.** `-` on the way to `-3` is a value the browser cannot read, so it reports
 *   `""`, and the model holds `""` — what the field already says. jsdom keeps no such text at all.
 * - **What is drawn.** A refused pick or keystroke is gone in the event that made it — by the field's
 *   own handler, which the field answers at once. Chromium draws a frame
 *   between an event and a timer, so an answer a task later was measured to show the refused pick in
 *   100 tries of 100; jsdom draws nothing, so this is asked of a browser.
 */
test.describe("fields only a browser settles", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/fields");
  });

  /** Starts a word the way a Japanese input method does — `n`, then `に` — and leaves it unfinished. */
  async function startWord(page: import("@playwright/test").Page, selector: string) {
    await page.locator(selector).click();
    const session = await page.context().newCDPSession(page);
    for (const text of ["n", "に"]) {
      await session.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    }
    return session;
  }

  /** Types 日本 the way a Japanese input method does: `n`, `に`, then the committed word. */
  async function compose(page: import("@playwright/test").Page, selector: string) {
    const session = await startWord(page, selector);
    await session.send("Input.insertText", { text: "日本" });
    await session.detach();
  }

  /**
   * A readout that says `text`, and still says it once nothing more has come: `toHaveText` passes on
   * the first reading that matches, and a word handed over a second time, a little later, must not.
   */
  async function stays(locator: import("@playwright/test").Locator, text: string) {
    await expect(locator).toHaveText(text);
    await locator.page().waitForTimeout(500);
    expect(await locator.textContent()).toBe(text);
  }

  for (const [suffix, on] of [
    ["", "a TextArea"],
    ["-input", "an <input>"],
  ]) {
    test(`a handler that skips composing input takes the word, once — on ${on}`, async ({ page }) => {
      await compose(page, `#skips${suffix}`);
      await stays(page.locator(`#skips${suffix}-taken`), '["日本"]');
      await expect(page.locator(`#skips${suffix}`)).toHaveValue("日本");
    });

    /**
     * Tab in the middle of a word: Chromium ends it with what was typed, and neither handler loses it —
     * nor hears it twice: one that took every step has it already.
     */
    for (const [handler, heard] of [
      ["skips", '["に"]'],
      ["takes", '["n","に"]'],
    ]) {
      test(`a word left in the middle keeps what was typed — ${handler}, on ${on}`, async ({ page }) => {
        const session = await startWord(page, `#${handler}${suffix}`);
        await page.keyboard.press("Tab");
        await stays(page.locator(`#${handler}${suffix}-taken`), heard);
        await expect(page.locator(`#${handler}${suffix}`)).toHaveValue("に");
        await session.detach();
      });
    }

    /** Each step of the word reaches a handler that reads every input, and the word is not handed over again. */
    test(`a handler that takes every input hears each step, and the word once — on ${on}`, async ({ page }) => {
      await compose(page, `#takes${suffix}`);
      await stays(page.locator(`#takes${suffix}-taken`), '["n","に","日本"]');
      await expect(page.locator(`#takes${suffix}`)).toHaveValue("日本");
    });
  }

  /**
   * A render between the events of one pick — the form around the fields counts every `input`, and the
   * select shows the count — does not write an old value back: each field's model is its own handler's
   * by then, the select's included, whose `change` comes after that render. Picked from the keyboard:
   * `selectOption` sends both events from one script, with no render between them.
   */
  test("a render in the middle of an event keeps what the user did", async ({ page }) => {
    await page.locator("#between-text").pressSequentially("abc");
    await page.locator("#between-size").focus();
    // From m, ArrowDown is l.
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#between-size")).toHaveAttribute("title", "4 changes");
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
    // Several fields, comma-separated, are read together: one frame, one entry, `l,m` for two.
    await page.evaluate(
      ([selector, read]) => {
        const fields = Array.from(document.querySelectorAll(selector)) as HTMLInputElement[];
        const probe = document.body.appendChild(document.createElement("div"));
        probe.style.cssText = "width:1px;height:1px";
        const w = window as unknown as { drawn: string[] };
        w.drawn = [];
        new ResizeObserver(() => w.drawn.push(fields.map((field) => String(field[read])).join(","))).observe(probe);
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
    // The frames first: a put-back too late shows in them, whatever the form reads after.
    const frames = await drawn(page);
    expect(frames.length).toBeGreaterThan(20);
    expect(frames).not.toContain("l");
    await expect(page.locator("#refused-read")).toHaveText("m");
    await expect(page.locator("#refused-size")).toHaveValue("m");
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

  test("a keystroke the handler refuses is never drawn — on an <input>", async ({ page }) => {
    await watchFrames(page, "#refused-input");
    await page.locator("#refused-input").click();
    await page.keyboard.press("End");
    for (let i = 0; i < 20; i++) {
      await page.keyboard.type("d");
      await page.waitForTimeout(40);
    }
    await expect(page.locator("#refused-input")).toHaveValue("abc");
    const frames = await drawn(page);
    expect(frames.length).toBeGreaterThan(20);
    expect(frames.filter((value) => value.length > 3)).toEqual([]);
  });

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

  /** The refused radio is put back with its group: `m` is on in every frame, and `l` in none. */
  test("a radio the handler will not pick is never drawn picked, and the group keeps its own", async ({ page }) => {
    await watchFrames(page, "#radio-l, #radio-m", "checked");
    for (let i = 0; i < 20; i++) {
      await page.locator("#radio-l").click();
      await page.waitForTimeout(40);
    }
    await expect(page.locator("#radio-m")).toBeChecked();
    await expect(page.locator("#radio-l")).not.toBeChecked();
    await expect(page.locator("#refused-input-model")).toHaveText('{"text":"abc","ticked":false,"size":"m"}');
    const frames = await drawn(page);
    expect(frames.length).toBeGreaterThan(20);
    // `m` then `l`, in document order: `m` on and `l` off, in every frame.
    expect(frames.filter((frame) => frame !== "true,false")).toEqual([]);
  });

  /**
   * The selection a refused paste replaced is put back as the browser had it, read at `beforeinput`. A
   * real paste, from the clipboard: what the field heard says so.
   */
  test("a refused paste over a selection puts the selection back", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => navigator.clipboard.writeText("12"));
    const field = page.locator("#refused-text");
    await field.click();
    await field.evaluate((element: HTMLTextAreaElement) => {
      element.setSelectionRange(1, 2);
      element.addEventListener("beforeinput", (event) => {
        (window as unknown as { heard: string }).heard = (event as InputEvent).inputType;
      });
    });
    await page.keyboard.press("ControlOrMeta+V");
    expect(await page.evaluate(() => (window as unknown as { heard: string }).heard)).toBe("insertFromPaste");

    expect(
      await field.evaluate((element: HTMLTextAreaElement) => [
        element.value,
        element.selectionStart,
        element.selectionEnd,
      ]),
    ).toEqual(["abc", 1, 2]);
  });

  /**
   * What a number field shows that is not a number yet. Its `value` reads `""` whether the text is there
   * or wiped, so what says it is there is `validity.badInput`: text the browser cannot read as a number.
   */
  const notANumberYet = (field: import("@playwright/test").Locator) =>
    field.evaluate((element: HTMLInputElement) => element.validity.badInput);

  /** The `-` stays while the number is not one yet, and `-3` is held once it is. */
  test("a number field keeps a minus typed before its number", async ({ page }) => {
    const field = page.locator("#signed");
    await field.selectText();
    await page.keyboard.type("-");
    await expect(page.locator("#signed-model")).toHaveText('""');
    expect(await notANumberYet(field)).toBe(true);
    await page.keyboard.type("3");
    await expect(page.locator("#signed-model")).toHaveText("-3");
    await expect(field).toHaveValue("-3");
  });

  /** `1e` on the way to `1e5`, the same: the text stays, and the number is held once it is one. */
  test("a number field keeps an exponent typed before its digits", async ({ page }) => {
    const field = page.locator("#signed");
    await field.selectText();
    await page.keyboard.type("1e");
    await expect(page.locator("#signed-model")).toHaveText('""');
    expect(await notANumberYet(field)).toBe(true);
    await page.keyboard.type("5");
    await expect(page.locator("#signed-model")).toHaveText("100000");
    await expect(field).toHaveValue("1e5");
  });
});
