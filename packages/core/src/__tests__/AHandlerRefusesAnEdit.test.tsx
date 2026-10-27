import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component, Select, TextArea, type EventOn } from "../index";
import { renderToString } from "../hydration/ssr";

/**
 * A field's handler decides an edit by what it writes: the edit, to take it; something else, to
 * rewrite it; nothing, to refuse it. Core answers the edit in the field's own listener, so by the
 * time the event bubbles to anything around the field, the field shows what the handler decided.
 */
describe("a field shows what its handler decided, before anything around it reads it", () => {
  /** An edit as a browser makes it: the field changes first, then `input` says so. */
  function edit(field: HTMLTextAreaElement, text: string) {
    field.value = text;
    field.setSelectionRange(text.length, text.length);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  }

  test("a rewrite is what a form around the field reads", async () => {
    const read: string[] = [];
    class Upper extends Component {
      @state text = "";
      typed(event: EventOn<HTMLTextAreaElement>) {
        this.text = event.currentTarget.value.toUpperCase();
      }
      heard(event: EventOn<HTMLFormElement>) {
        read.push((event.target as HTMLTextAreaElement).value);
      }
      render() {
        return (
          <form oninput={this.heard}>
            <TextArea id="t" aria-label="Upper" value={this.text} oninput={this.typed} />
          </form>
        );
      }
    }
    const app = await getDOM<Upper>(<Upper />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    edit(field, "ab");
    await app.settle();

    expect({ read, shown: field.value, model: app.instance.text }).toEqual({ read: ["AB"], shown: "AB", model: "AB" });
  });

  test("a refusal is what a form around the field reads", async () => {
    const read: string[] = [];
    class Short extends Component {
      @state text = "abc";
      typed(event: EventOn<HTMLTextAreaElement>) {
        if (event.currentTarget.value.length <= 3) this.text = event.currentTarget.value;
      }
      heard(event: EventOn<HTMLFormElement>) {
        read.push((event.target as HTMLTextAreaElement).value);
      }
      render() {
        return (
          <form oninput={this.heard}>
            <TextArea id="t" aria-label="Short" value={this.text} oninput={this.typed} />
          </form>
        );
      }
    }
    const app = await getDOM<Short>(<Short />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    edit(field, "abcd");

    expect({ read, shown: field.value }).toEqual({ read: ["abc"], shown: "abc" });
  });

  /**
   * The two deliveries measured for a composition; only Firefox sends an `input` after its end. What
   * the field held in the middle of the word is handed back: writing to a field mid-composition
   * cancels the word being typed.
   */
  function compose(field: HTMLTextAreaElement, word: string, browser: "chromium" | "firefox"): string {
    const from = field.value;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = from + word;
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: word }));
    const during = field.value;
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: word }));
    if (browser === "firefox") {
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: word }));
    }
    return during;
  }

  test.each(["chromium", "firefox"] as const)(
    "a composition is left alone while it lasts, and a word the handler refused is gone when it ends (%s)",
    async (browser) => {
      class Short extends Component {
        @state text = "abc";
        typed(event: EventOn<HTMLTextAreaElement>) {
          if (event.currentTarget.value.length <= 3) this.text = event.currentTarget.value;
        }
        render() {
          return <TextArea id="t" aria-label="Short" value={this.text} oninput={this.typed} />;
        }
      }
      const app = await getDOM<Short>(<Short />);
      await app.settle();
      const field = app.container.querySelector("#t") as HTMLTextAreaElement;
      const during = compose(field, "日本", browser);
      await app.settle();

      expect({ during, shown: field.value, model: app.instance.text }).toEqual({
        during: "abc日本",
        shown: "abc",
        model: "abc",
      });
    },
  );
});

/**
 * A handler that limits the text, typed through an input method: one that waits for the finished word
 * refuses it whole, and the field goes back to the text before the word; one that refuses steps keeps
 * the steps it took — a reading the input method had not finished.
 */
test.each([
  ["waits for the finished word", true, "ab"],
  ["takes the steps it allows", false, "abに"],
] as const)("a length limit that %s", async (_name, waits, kept) => {
  class Short extends Component {
    @state text = "ab";
    typed(event: EventOn<HTMLInputElement, InputEvent>) {
      if (waits && event.isComposing) return;
      if (event.currentTarget.value.length <= 3) this.text = event.currentTarget.value;
    }
    render() {
      return <input id="i" aria-label="Short" value={this.text} oninput={this.typed} />;
    }
  }
  const app = await getDOM<Short>(<Short />);
  await app.settle();
  const field = app.container.querySelector("#i") as HTMLInputElement;
  field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  for (const step of ["abn", "abに", "abにh", "abにほ", "ab日本"]) {
    field.value = step;
    field.dispatchEvent(
      new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText" }),
    );
  }
  field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
  await app.settle();

  expect({ shown: field.value, model: app.instance.text }).toEqual({ shown: kept, model: kept });
});

describe("a pick the handler refused", () => {
  test("is gone from the select", async () => {
    class Shop extends Component {
      @state size = "m";
      pick(event: EventOn<HTMLSelectElement>) {
        if (event.currentTarget.value !== "l") this.size = event.currentTarget.value;
      }
      render() {
        return (
          <Select id="s" aria-label="Size" value={this.size} onchange={this.pick}>
            <option value="s">s</option>
            <option value="m">m</option>
            <option value="l">l</option>
          </Select>
        );
      }
    }
    const app = await getDOM<Shop>(<Shop />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    select.value = "l";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect({ model: app.instance.size, shown: select.value }).toEqual({ model: "m", shown: "m" });
  });

  test("is gone from a multiple select, as the list of chosen values", async () => {
    class Tags extends Component {
      @state tags = ["a"];
      pick(event: EventOn<HTMLSelectElement>) {
        const chosen = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
        if (chosen.length <= 2) this.tags = chosen;
      }
      render() {
        return (
          <Select id="s" aria-label="Tags" multiple value={this.tags} onchange={this.pick}>
            <option value="a">a</option>
            <option value="b">b</option>
            <option value="c">c</option>
          </Select>
        );
      }
    }
    const app = await getDOM<Tags>(<Tags />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    for (const option of Array.from(select.options)) option.selected = true;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(Array.from(select.selectedOptions, (option) => option.value)).toEqual(["a"]);
  });

  /** A model of one value on a `multiple` select — written `multiple` or `multiple=""` — is a list of one. */
  test.each([
    ["multiple", { multiple: true }],
    ['multiple=""', { multiple: "" }],
  ] as const)("is gone from a %s select whose model is one value", async (_name, multiple) => {
    class Tags extends Component {
      @state tag = "a";
      pick(event: EventOn<HTMLSelectElement>) {
        if (event.currentTarget.selectedOptions.length === 1) this.tag = event.currentTarget.value;
      }
      render() {
        const written = multiple as Record<string, unknown>;
        return (
          <Select id="s" aria-label="Tags" {...written} value={this.tag} onchange={this.pick}>
            <option value="a">a</option>
            <option value="b">b</option>
          </Select>
        );
      }
    }
    const app = await getDOM<Tags>(<Tags />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    for (const option of Array.from(select.options)) option.selected = true;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(Array.from(select.selectedOptions, (option) => option.value)).toEqual(["a"]);
  });

  test("leaves a checkbox as it was", async () => {
    class Terms extends Component {
      @state accepted = false;
      notYet(_event: EventOn<HTMLInputElement>) {}
      render() {
        return <input id="c" type="checkbox" aria-label="Terms" checked={this.accepted} onchange={this.notYet} />;
      }
    }
    const app = await getDOM<Terms>(<Terms />);
    await app.settle();
    const box = app.container.querySelector("#c") as HTMLInputElement;
    box.click();

    expect(box.checked).toBe(false);
  });

  test("leaves a radio its value, and its group as it was", async () => {
    class Pets extends Component {
      @state pet = "a";
      notThat(_event: EventOn<HTMLInputElement>) {}
      render() {
        return (
          <form>
            <input id="a" type="radio" name="pet" value="a" checked={this.pet === "a"} onchange={this.notThat} />
            <input id="b" type="radio" name="pet" value="b" checked={this.pet === "b"} onchange={this.notThat} />
          </form>
        );
      }
    }
    const app = await getDOM<Pets>(<Pets />);
    await app.settle();
    const a = app.container.querySelector("#a") as HTMLInputElement;
    const b = app.container.querySelector("#b") as HTMLInputElement;
    b.click();

    expect({ pet: app.instance.pet, value: b.value, checked: [a.checked, b.checked] }).toEqual({
      pet: "a",
      value: "b",
      checked: [true, false],
    });
  });
});

/** A number field has no caret: what it shows is put back without one. */
test("a number field whose handler refused the edit shows the model", async () => {
  class Age extends Component {
    @state age = "30";
    typed(event: EventOn<HTMLInputElement>) {
      if (Number(event.currentTarget.value) < 150) this.age = event.currentTarget.value;
    }
    render() {
      return <input id="n" type="number" aria-label="Age" value={this.age} oninput={this.typed} />;
    }
  }
  const app = await getDOM<Age>(<Age />);
  await app.settle();
  const field = app.container.querySelector("#n") as HTMLInputElement;
  field.value = "300";
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));

  expect(field.value).toBe("30");
});

/** SVG's `transform` is the attribute it is, on the server as in the browser. */
test("an SVG transform is written as an attribute", async () => {
  class Shape extends Component {
    render() {
      return (
        <svg>
          <g transform="translate(10, 0)" />
        </svg>
      );
    }
  }
  const html = await renderToString(<Shape />);
  const app = await getDOM(<Shape />);
  await app.settle();

  expect({
    served: html.includes('transform="translate(10, 0)"'),
    shown: app.container.querySelector("g")?.getAttribute("transform"),
  }).toEqual({ served: true, shown: "translate(10, 0)" });
});

/** Round 34: a field's handlers are handed the event they are promised. */
describe("the event a field's handler is handed", () => {
  /** Each step of a word reaches `oninput` as the browser sent it; a handler that took them is handed nothing more. */
  test("each step of a word reaches `oninput` as an input that is composing", async () => {
    class Words extends Component {
      @state text = "";
      seen: string[] = [];
      typed(event: EventOn<HTMLTextAreaElement, InputEvent>) {
        this.seen.push(`${event.inputType} ${event.isComposing} ${event.currentTarget.value}`);
        this.text = event.currentTarget.value;
      }
      render() {
        return <TextArea id="t" aria-label="Words" value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Words>(<Words />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    for (const step of ["に", "日本"]) {
      field.value = step;
      field.dispatchEvent(
        new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText" }),
      );
    }
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    await app.settle();

    expect(app.instance.seen).toEqual(["insertCompositionText true に", "insertCompositionText true 日本"]);
  });

  /**
   * Chromium's last `input` of a word still says `isComposing`, and nothing follows its end: a handler
   * that waits for the finished word is handed it at `compositionend`, once, before `oncompositionend`.
   */
  test("a handler that waits for the finished word is handed it once, at its end", async () => {
    class Words extends Component {
      @state text = "";
      seen: string[] = [];
      typed(event: EventOn<HTMLTextAreaElement, InputEvent>) {
        if (event.isComposing) return;
        this.seen.push(`${event.type} ${event.inputType} ${event.currentTarget.value}`);
        this.text = event.currentTarget.value;
      }
      ended(_event: EventOn<HTMLTextAreaElement>) {
        this.seen.push(`compositionend ${this.text}`);
      }
      render() {
        return (
          <TextArea id="t" aria-label="Words" value={this.text} oninput={this.typed} oncompositionend={this.ended} />
        );
      }
    }
    const app = await getDOM<Words>(<Words />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "日本";
    field.dispatchEvent(
      new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText" }),
    );
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    // Firefox's own `input` after the end: the field shows what it holds, and no handler hears it.
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText" }));
    await app.settle();

    expect({ seen: app.instance.seen, model: app.instance.text, shown: field.value }).toEqual({
      seen: ["input insertCompositionText 日本", "compositionend 日本"],
      model: "日本",
      shown: "日本",
    });
  });

  /** What the handler stops on the word it is handed is asked of an `input` that never was: the real end bubbles on. */
  test("a handler stopping the word it is handed leaves the real compositionend alone", async () => {
    class Words extends Component {
      @state text = "";
      heard: string[] = [];
      typed(event: EventOn<HTMLInputElement, InputEvent>) {
        if (event.isComposing) return;
        event.stopImmediatePropagation();
        this.text = event.currentTarget.value;
      }
      ended(_event: EventOn<HTMLDivElement>) {
        this.heard.push("compositionend");
      }
      render() {
        return (
          <div oncompositionend={this.ended}>
            <input id="i" aria-label="Words" value={this.text} oninput={this.typed} />
          </div>
        );
      }
    }
    const app = await getDOM<Words>(<Words />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "日本";
    field.dispatchEvent(
      new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText" }),
    );
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    await app.settle();

    expect({ heard: app.instance.heard, model: app.instance.text }).toEqual({
      heard: ["compositionend"],
      model: "日本",
    });
  });

  /** A pick is answered on its `input`; `onchange` stopping its `change` stops the real one. */
  test("`onchange` on a pick is handed a change, and stopping it stops the change", async () => {
    class Sizes extends Component {
      @state size = "m";
      types: string[] = [];
      formHeard = 0;
      picked(event: EventOn<HTMLSelectElement>) {
        this.types.push(event.type);
        event.stopPropagation();
        this.size = event.currentTarget.value;
      }
      dirty() {
        this.formHeard++;
      }
      render() {
        return (
          <form onchange={this.dirty}>
            <Select id="s" aria-label="Size" value={this.size} onchange={this.picked}>
              <option value="m">m</option>
              <option value="l">l</option>
            </Select>
          </form>
        );
      }
    }
    const app = await getDOM<Sizes>(<Sizes />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    select.value = "l";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await app.settle();

    expect({ types: app.instance.types, formHeard: app.instance.formHeard, size: app.instance.size }).toEqual({
      types: ["change"],
      formHeard: 0,
      size: "l",
    });
  });

  /** An `input` dispatched alone — a test, a script — does not take the next, unrelated `change`. */
  test("a pick's input with no change after it leaves the next change its own", async () => {
    class Sizes extends Component {
      @state size = "m";
      changes = 0;
      picked(event: EventOn<HTMLSelectElement>) {
        this.changes++;
        this.size = event.currentTarget.value;
      }
      render() {
        return (
          <Select id="s" aria-label="Size" value={this.size} onchange={this.picked}>
            <option value="m">m</option>
            <option value="l">l</option>
            <option value="s">s</option>
          </Select>
        );
      }
    }
    const app = await getDOM<Sizes>(<Sizes />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    select.value = "l";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    await app.settle();
    select.dispatchEvent(new FocusEvent("blur"));
    select.value = "s";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await app.settle();

    expect({ changes: app.instance.changes, size: app.instance.size }).toEqual({ changes: 2, size: "s" });
  });

  /** `cancelBubble = true` and `returnValue = false` ask what the methods ask, of the `change` promised. */
  test("a pick's onchange stops its change through cancelBubble, and reads its own preventDefault", async () => {
    class Sizes extends Component {
      @state size = "m";
      formHeard = 0;
      prevented: boolean[] = [];
      picked(event: EventOn<HTMLSelectElement>) {
        event.cancelBubble = true;
        event.preventDefault();
        this.prevented.push(event.defaultPrevented, event.cancelBubble);
        this.size = event.currentTarget.value;
      }
      dirty() {
        this.formHeard++;
      }
      render() {
        return (
          <form onchange={this.dirty}>
            <Select id="s" aria-label="Size" value={this.size} onchange={this.picked}>
              <option value="m">m</option>
              <option value="l">l</option>
            </Select>
          </form>
        );
      }
    }
    const app = await getDOM<Sizes>(<Sizes />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    select.value = "l";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await app.settle();

    expect({ formHeard: app.instance.formHeard, prevented: app.instance.prevented }).toEqual({
      formHeard: 0,
      prevented: [true, true],
    });
  });
});
