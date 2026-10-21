import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component, Select, TextArea, type EventOn, type TransformInput } from "../index";
import { renderToString } from "../hydration/ssr";

/**
 * `transform` decides an edit in the field's own listener, before any other listener reads it. So
 * every reader — the field's handler, a form around it — reads the decided value in the same event,
 * and nothing has to be put back after them.
 */
describe("a field's transform decides the edit before anyone reads it", () => {
  /** An edit as a browser makes it: the field changes first, then `input` says so. */
  function edit(field: HTMLTextAreaElement, text: string, caret = text.length, inputType = "insertText") {
    field.value = text;
    field.setSelectionRange(caret, caret);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
  }

  test("a refused keystroke never reaches the handler, and is gone from the field", () => {
    const read: string[] = [];
    class Short extends Component {
      @state text = "abc";
      typed(event: EventOn<HTMLTextAreaElement>) {
        read.push(event.currentTarget.value);
        this.text = event.currentTarget.value;
      }
      max3(next: string, prev: string): string {
        return next.length <= 3 ? next : prev;
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.typed} transform={this.max3} />;
      }
    }
    return getDOM<Short>(<Short />).then(async (app) => {
      await app.settle();
      const field = app.container.querySelector("#t") as HTMLTextAreaElement;
      edit(field, "abcd");

      expect({ read, shown: field.value }).toEqual({ read: [], shown: "abc" });
    });
  });

  test("a refused keystroke in the middle puts the caret back where it was", async () => {
    class Short extends Component {
      @state text = "abc";
      typed(event: EventOn<HTMLTextAreaElement>) {
        this.text = event.currentTarget.value;
      }
      max3(next: string, prev: string): string {
        return next.length <= 3 ? next : prev;
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.typed} transform={this.max3} />;
      }
    }
    const app = await getDOM<Short>(<Short />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    // `x` typed between `a` and `b`: the caret is after it, at 2.
    edit(field, "axbc", 2);

    expect({ shown: field.value, caret: field.selectionStart }).toEqual({ shown: "abc", caret: 1 });
  });

  test("a rewrite is what the handler and a form around the field both read", async () => {
    const read: string[] = [];
    class Upper extends Component {
      @state text = "";
      typed(event: EventOn<HTMLTextAreaElement>) {
        this.text = event.currentTarget.value;
      }
      heard(event: EventOn<HTMLFormElement>) {
        read.push((event.target as HTMLTextAreaElement).value);
      }
      upper(next: string): string {
        return next.toUpperCase();
      }
      render() {
        return (
          <form oninput={this.heard}>
            <TextArea id="t" value={this.text} oninput={this.typed} transform={this.upper} />
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

  test("it is told the edit's kind and where the caret is", async () => {
    const told: TransformInput[] = [];
    class Told extends Component {
      @state text = "ab";
      typed(event: EventOn<HTMLTextAreaElement>) {
        this.text = event.currentTarget.value;
      }
      keep(next: string, _prev: string, input: TransformInput): string {
        told.push(input);
        return next;
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.typed} transform={this.keep} />;
      }
    }
    const app = await getDOM<Told>(<Told />);
    await app.settle();
    edit(app.container.querySelector("#t") as HTMLTextAreaElement, "a", 1, "deleteContentBackward");

    expect(told).toEqual([{ inputType: "deleteContentBackward", selectionStart: 1, selectionEnd: 1 }]);
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
    "a composition is left alone while it lasts, and its word decided when it ends (%s)",
    async (browser) => {
      class Short extends Component {
        @state text = "abc";
        taken: string[] = [];
        typed(event: EventOn<HTMLTextAreaElement>) {
          if ((event as unknown as InputEvent).isComposing) return;
          this.taken.push(event.currentTarget.value);
          this.text = event.currentTarget.value;
        }
        max3(next: string, prev: string): string {
          return next.length <= 3 ? next : prev;
        }
        render() {
          return <TextArea id="t" value={this.text} oninput={this.typed} transform={this.max3} />;
        }
      }
      const app = await getDOM<Short>(<Short />);
      await app.settle();
      const field = app.container.querySelector("#t") as HTMLTextAreaElement;
      const during = compose(field, "日本", browser);

      // The word is whole while it is typed, and refused once it is — and a refused word is not handed over.
      expect({ during, shown: field.value, taken: app.instance.taken }).toEqual({
        during: "abc日本",
        shown: "abc",
        taken: [],
      });
    },
  );

  test("a refused pick never reaches the select's handler, and is gone from the select", async () => {
    const read: string[] = [];
    class Shop extends Component {
      @state size = "m";
      pick(event: EventOn<HTMLSelectElement>) {
        read.push(event.currentTarget.value);
        this.size = event.currentTarget.value;
      }
      inStock(next: string, prev: string): string {
        return next === "l" ? prev : next;
      }
      render() {
        return (
          <Select id="s" value={this.size} onchange={this.pick} transform={this.inStock}>
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

    expect({ read, shown: select.value }).toEqual({ read: [], shown: "m" });
  });

  test("a multiple select is decided as the list of chosen values", async () => {
    class Tags extends Component {
      @state tags = ["a"];
      picks = 0;
      pick(event: EventOn<HTMLSelectElement>) {
        this.picks++;
        this.tags = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
      }
      atMostTwo(next: string[], prev: string[]): string[] {
        return next.length <= 2 ? next : prev;
      }
      render() {
        return (
          <Select id="s" multiple value={this.tags} onchange={this.pick} transform={this.atMostTwo}>
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

    expect({ chosen: Array.from(select.selectedOptions, (option) => option.value), picks: app.instance.picks }).toEqual(
      {
        chosen: ["a"],
        picks: 0,
      },
    );
  });
});

/** The same on a plain `<input>`, where the attribute pass gives the field its `transform`. */
describe("an input's transform decides the edit before anyone reads it", () => {
  function edit(field: HTMLInputElement, text: string, caret = text.length) {
    field.value = text;
    field.setSelectionRange(caret, caret);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  }

  /** `oninput` is written BEFORE `transform`: the decision still comes first. */
  class Phone extends Component {
    @state phone = "064";
    @state limited = true;
    read: string[] = [];
    typed(event: EventOn<HTMLInputElement>) {
      this.read.push(event.currentTarget.value);
      this.phone = event.currentTarget.value;
    }
    digits(next: string, prev: string): string {
      return /^\d*$/.test(next) ? next : prev;
    }
    render() {
      return (
        <input id="i" value={this.phone} oninput={this.typed} transform={this.limited ? this.digits : undefined} />
      );
    }
  }

  test("a refused keystroke never reaches the handler, whatever the attribute order", async () => {
    const app = await getDOM<Phone>(<Phone />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    edit(field, "064a");

    expect({ read: app.instance.read, shown: field.value }).toEqual({ read: [], shown: "064" });
  });

  test("a refused keystroke in the middle puts the caret back where it was", async () => {
    const app = await getDOM<Phone>(<Phone />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    edit(field, "0x64", 2);

    expect({ shown: field.value, caret: field.selectionStart }).toEqual({ shown: "064", caret: 1 });
  });

  test("an accepted edit is the model's after the render, as the attribute the next edit is decided against", async () => {
    const app = await getDOM<Phone>(<Phone />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    edit(field, "0641");
    await app.settle();
    edit(field, "0641x");

    expect({ shown: field.value, model: app.instance.phone }).toEqual({ shown: "0641", model: "0641" });
  });

  test("a transform taken away by a render no longer decides", async () => {
    const app = await getDOM<Phone>(<Phone />);
    await app.settle();
    app.instance.limited = false;
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    edit(field, "064a");

    expect(field.value).toBe("064a");
  });

  test("a checkbox the transform keeps off is never ticked, and its handler never hears of it", async () => {
    const read: boolean[] = [];
    class Terms extends Component {
      @state agreed = false;
      ticked(event: EventOn<HTMLInputElement>) {
        read.push(event.currentTarget.checked);
        this.agreed = event.currentTarget.checked;
      }
      locked(_next: boolean, prev: boolean): boolean {
        return prev;
      }
      render() {
        return <input id="c" type="checkbox" checked={this.agreed} onchange={this.ticked} transform={this.locked} />;
      }
    }
    const app = await getDOM<Terms>(<Terms />);
    await app.settle();
    const box = app.container.querySelector("#c") as HTMLInputElement;
    box.click();

    expect({ read, checked: box.checked }).toEqual({ read: [], checked: false });
  });

  test("a number field, which has no caret, is decided without one", async () => {
    class Age extends Component {
      @state age = "30";
      typed(event: EventOn<HTMLInputElement>) {
        this.age = event.currentTarget.value;
      }
      under150(next: string, prev: string): string {
        return Number(next) < 150 ? next : prev;
      }
      render() {
        return <input id="n" type="number" value={this.age} oninput={this.typed} transform={this.under150} />;
      }
    }
    const app = await getDOM<Age>(<Age />);
    await app.settle();
    const field = app.container.querySelector("#n") as HTMLInputElement;
    field.value = "300";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));

    expect(field.value).toBe("30");
  });

  test("it is never markup: a served input carries no transform, and an SVG transform stays an attribute", async () => {
    class Both extends Component {
      digits(next: string, prev: string): string {
        return /^\d*$/.test(next) ? next : prev;
      }
      render() {
        return (
          <div>
            <input value="1" transform={this.digits} />
            <svg>
              <g transform="translate(10, 0)" />
            </svg>
          </div>
        );
      }
    }
    const html = await renderToString(<Both />);

    expect({ input: /<input[^>]*transform/.test(html), svg: html.includes('transform="translate(10, 0)"') }).toEqual({
      input: false,
      svg: true,
    });
  });
});

/** What a refused edit leaves: the caret where the edit found it, and a box's pick as it was. */
describe("a refused edit leaves the field as the edit found it", () => {
  class Locked extends Component {
    @state text = "abc";
    typed(event: EventOn<HTMLTextAreaElement>) {
      this.text = event.currentTarget.value;
    }
    refuse(_next: string, prev: string): string {
      return prev;
    }
    render() {
      return <TextArea id="t" value={this.text} oninput={this.typed} transform={this.refuse} />;
    }
  }

  /** Delete pressed in `a|bc` takes the `b` AFTER the caret: the caret never moved, and stays at 1. */
  test("a delete forward keeps the caret where it was", async () => {
    const app = await getDOM<Locked>(<Locked />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.value = "ac";
    field.setSelectionRange(1, 1);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentForward" }));

    expect({ shown: field.value, caret: field.selectionStart }).toEqual({ shown: "abc", caret: 1 });
  });

  /** Backspace in `ab|c` takes the `b` BEFORE the caret, which moved to 1: back to 2. */
  test("a delete backward puts the caret back after what it took", async () => {
    const app = await getDOM<Locked>(<Locked />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.value = "ac";
    field.setSelectionRange(1, 1);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));

    expect({ shown: field.value, caret: field.selectionStart }).toEqual({ shown: "abc", caret: 2 });
  });

  /** A radio's transform is told whether it is checked, as a checkbox's is — never its `value`. */
  test("a radio whose transform refuses the pick keeps its value and its group", async () => {
    class Pets extends Component {
      @state pet = "a";
      told: unknown[] = [];
      /** Reads `value`, as a radio's handler usually does: a refused pick never reaches it. */
      picked(event: EventOn<HTMLInputElement>) {
        this.pet = event.currentTarget.value;
      }
      refuse(next: boolean, prev: boolean): boolean {
        this.told.push([next, prev]);
        return prev;
      }
      render() {
        return (
          <form>
            {["a", "b"].map((pet) => (
              <input
                id={pet}
                type="radio"
                name="pet"
                value={pet}
                checked={this.pet === pet}
                onchange={this.picked}
                transform={this.refuse}
              />
            ))}
          </form>
        );
      }
    }
    const app = await getDOM<Pets>(<Pets />);
    await app.settle();
    const a = app.container.querySelector("#a") as HTMLInputElement;
    const b = app.container.querySelector("#b") as HTMLInputElement;
    b.click();

    expect({
      pet: app.instance.pet,
      value: b.value,
      checked: [a.checked, b.checked],
      told: app.instance.told,
    }).toEqual({ pet: "a", value: "b", checked: [true, false], told: [[true, false]] });
  });

  /** A refused pick is no pick: neither of the box's handlers runs, on its `input` or its `change`. */
  test("a checkbox whose transform refuses the tick calls no handler", async () => {
    class Terms extends Component {
      @state accepted = false;
      calls: string[] = [];
      typed() {
        this.calls.push("oninput");
      }
      changed() {
        this.calls.push("onchange");
      }
      notYet(_next: boolean, prev: boolean): boolean {
        return prev;
      }
      render() {
        return (
          <input
            id="c"
            type="checkbox"
            aria-label="Terms"
            checked={this.accepted}
            oninput={this.typed}
            onchange={this.changed}
            transform={this.notYet}
          />
        );
      }
    }
    const app = await getDOM<Terms>(<Terms />);
    await app.settle();
    const box = app.container.querySelector("#c") as HTMLInputElement;
    box.click();

    expect({ calls: app.instance.calls, checked: box.checked }).toEqual({ calls: [], checked: false });
  });
});

/**
 * `on:input` is refused by the types — a standard event has one spelling — but a caller the types do
 * not reach (JavaScript, a spread of something untyped) can still hand it over, so the field answers
 * it as its own: after the edit is decided, never around it.
 */
describe("a handler written `on:input`, past the types", () => {
  test("on a TextArea, never hears an edit the transform refuses", async () => {
    class Short extends Component {
      @state text = "abc";
      heard: string[] = [];
      typed(event: EventOn<HTMLTextAreaElement>) {
        this.heard.push(event.currentTarget.value);
        this.text = event.currentTarget.value;
      }
      max3(next: string, prev: string): string {
        return next.length <= 3 ? next : prev;
      }
      render() {
        const untyped: Record<string, unknown> = { "on:input": this.typed };
        return <TextArea id="t" aria-label="Short" value={this.text} {...untyped} transform={this.max3} />;
      }
    }
    const app = await getDOM<Short>(<Short />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.value = "abcd";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    await app.settle();
    field.value = "ab";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    await app.settle();

    expect({ heard: app.instance.heard, model: app.instance.text, shown: field.value }).toEqual({
      heard: ["ab"],
      model: "ab",
      shown: "ab",
    });
  });

  test("on a Select, never hears a pick the transform refuses", async () => {
    class Sizes extends Component {
      @state size = "m";
      heard: string[] = [];
      picked(event: EventOn<HTMLSelectElement>) {
        this.heard.push(event.currentTarget.value);
        this.size = event.currentTarget.value;
      }
      inStock(next: string, prev: string): string {
        return next === "l" ? prev : next;
      }
      render() {
        const untyped: Record<string, unknown> = { "on:input": this.picked };
        return (
          <Select id="s" aria-label="Size" value={this.size} {...untyped} transform={this.inStock}>
            <option value="m">m</option>
            <option value="l">l</option>
          </Select>
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

    expect({ heard: app.instance.heard, model: app.instance.size, shown: select.value }).toEqual({
      heard: [],
      model: "m",
      shown: "m",
    });
  });

  /** The model's choices in another order are the same choice: refused, and no handler hears it. */
  test("a multiple select refused in another order than the model's is still refused", async () => {
    class Tags extends Component {
      @state tags = ["b", "a"];
      picks = 0;
      pick(event: EventOn<HTMLSelectElement>) {
        this.picks++;
        this.tags = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
      }
      onlyAB(next: string[]): string[] {
        return next.filter((tag) => tag === "a" || tag === "b");
      }
      render() {
        return (
          <Select id="s" aria-label="Tags" multiple value={this.tags} onchange={this.pick} transform={this.onlyAB}>
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

    expect({ picks: app.instance.picks, tags: app.instance.tags }).toEqual({ picks: 0, tags: ["b", "a"] });
  });
});

/**
 * The unfinished word reaches no handler, so a handler that takes every input — every
 * `@ramonda/form` field's does — cannot write past a `transform`: the word is decided whole, at its end.
 */
describe("an input method's word and a transform", () => {
  test("a handler that takes every input cannot write a word the transform refuses", async () => {
    class Short extends Component {
      @state text = "abc";
      heard: string[] = [];
      typed(event: EventOn<HTMLTextAreaElement>) {
        this.heard.push(event.currentTarget.value);
        this.text = event.currentTarget.value;
      }
      max3(next: string, prev: string): string {
        return next.length <= 3 ? next : prev;
      }
      render() {
        return <TextArea id="t" aria-label="Short" value={this.text} oninput={this.typed} transform={this.max3} />;
      }
    }
    const app = await getDOM<Short>(<Short />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    for (const step of ["abcに", "abc日本"]) {
      field.value = step;
      field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
      await app.settle();
    }
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    await app.settle();

    expect({ heard: app.instance.heard, model: app.instance.text, shown: field.value }).toEqual({
      heard: [],
      model: "abc",
      shown: "abc",
    });
  });
});

/** Round 34: a field's handlers are handed the event they are promised. */
describe("the event a field's handler is handed", () => {
  test("the word an input method commits reaches `oninput` as an input, and the transform knows it", async () => {
    class Words extends Component {
      @state text = "";
      seen: string[] = [];
      told: string[] = [];
      typed(event: EventOn<HTMLTextAreaElement, InputEvent>) {
        this.seen.push(`${event.type}:${event.inputType}`);
        this.text = event.currentTarget.value;
      }
      keep(next: string, _prev: string, input: TransformInput): string {
        this.told.push(input.inputType);
        return next;
      }
      render() {
        return <TextArea id="t" aria-label="Words" value={this.text} oninput={this.typed} transform={this.keep} />;
      }
    }
    const app = await getDOM<Words>(<Words />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "日本";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    await app.settle();

    expect({ seen: app.instance.seen, told: app.instance.told }).toEqual({
      seen: ["input:insertCompositionText"],
      told: ["insertCompositionText"],
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
});

/** A transform that answers nothing — a missing `return`, which only a caller past the types can write. */
test("a transform that returns nothing refuses the edit", async () => {
  class Digits extends Component {
    @state text = "12";
    heard: string[] = [];
    typed(event: EventOn<HTMLTextAreaElement>) {
      this.heard.push(event.currentTarget.value);
      this.text = event.currentTarget.value;
    }
    render() {
      const forgetful = ((next: string) => {
        if (/^\d*$/.test(next)) return next;
      }) as unknown as (next: string, prev: string) => string;
      return <TextArea id="t" aria-label="Digits" value={this.text} oninput={this.typed} transform={forgetful} />;
    }
  }
  const app = await getDOM<Digits>(<Digits />);
  await app.settle();
  const field = app.container.querySelector("#t") as HTMLTextAreaElement;
  field.value = "12a";
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  await app.settle();

  expect({ heard: app.instance.heard, model: app.instance.text, shown: field.value }).toEqual({
    heard: [],
    model: "12",
    shown: "12",
  });
});
