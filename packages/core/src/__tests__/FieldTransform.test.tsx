import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component, Select, TextArea, type EventOn, type TransformInput } from "../index";

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

  test("a refused keystroke is gone before the handler reads the field", () => {
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

      expect({ read, shown: field.value }).toEqual({ read: ["abc"], shown: "abc" });
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
        typed(event: EventOn<HTMLTextAreaElement>) {
          if ((event as unknown as InputEvent).isComposing) return;
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

      // The word is whole while it is typed, and refused once it is.
      expect({ during, shown: field.value }).toEqual({ during: "abc日本", shown: "abc" });
    },
  );

  test("a refused pick is gone before the handler reads the select", async () => {
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

    expect({ read, shown: select.value }).toEqual({ read: ["m"], shown: "m" });
  });

  test("a multiple select is decided as the list of chosen values", async () => {
    class Tags extends Component {
      @state tags = ["a"];
      pick(event: EventOn<HTMLSelectElement>) {
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

    expect(Array.from(select.selectedOptions, (option) => option.value)).toEqual(["a"]);
  });
});
