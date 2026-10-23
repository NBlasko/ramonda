import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { mounted, state } from "../base/decorators";
import { Component, createRef, type EventOn, type TransformInput } from "../index";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD062 — a field sent an edit while a commit runs.
 *
 * A field learns its model through render, and the render an edit's handler causes runs once the
 * commit is over. One edit sent from a `@mounted` is answered like any; a second that reads the
 * model — a `transform`'s `prev`, the check after `oncompositionend` — reads it as it was. That read
 * is reported; the edit is still answered.
 */
let messages: string[];
let stop: () => void;

beforeEach(() => {
  resetDiagnostics();
  messages = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as { message: string };
    if (detail.message.startsWith("[RMD062]")) messages.push(detail.message);
  };
  window.addEventListener("ramonda:dev-log", handler);
  stop = () => window.removeEventListener("ramonda:dev-log", handler);
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

function typeInto(field: HTMLInputElement, text: string): void {
  field.value = text;
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
}

describe("RMD062", () => {
  test("a second edit from a @mounted, whose transform reads the model, is reported", async () => {
    class Shout extends Component {
      @state text = "";
      field = createRef<HTMLInputElement>();
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value.toUpperCase();
      }
      keep(next: string, _prev: string, _input: TransformInput): string {
        return next;
      }
      @mounted
      fill() {
        const field = this.field.current as HTMLInputElement;
        typeInto(field, "a");
        typeInto(field, `${field.value}b`);
      }
      render() {
        return (
          <input aria-label="Shout" ref={this.field} value={this.text} oninput={this.typed} transform={this.keep} />
        );
      }
    }
    const app = await getDOM<Shout>(<Shout />);
    await app.settle();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("its transform's `prev`");
  });

  test("a word that ends while a commit runs is reported", async () => {
    class Chat extends Component {
      @state text = "x";
      field = createRef<HTMLInputElement>();
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value;
      }
      sent() {
        this.text = "";
      }
      @mounted
      compose() {
        const field = this.field.current as HTMLInputElement;
        field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        field.value = "x日本";
        field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
        field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
      }
      render() {
        return (
          <input
            aria-label="Chat"
            ref={this.field}
            value={this.text}
            oninput={this.typed}
            oncompositionend={this.sent}
          />
        );
      }
    }
    const app = await getDOM<Chat>(<Chat />);
    await app.settle();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("the end of its word");
  });

  /** One edit from a @mounted reads nothing its render has not written: it is answered, and says nothing. */
  test("one click, or one edit through a transform, from a @mounted is not reported", async () => {
    class Terms extends Component {
      @state on = false;
      @state text = "";
      box = createRef<HTMLInputElement>();
      field = createRef<HTMLInputElement>();
      flipped(event: EventOn<HTMLInputElement>) {
        this.on = event.currentTarget.checked;
      }
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value;
      }
      keep(next: string): string {
        return next;
      }
      @mounted
      start() {
        this.box.current?.click();
        typeInto(this.field.current as HTMLInputElement, "a");
      }
      render() {
        return (
          <div>
            <input type="checkbox" aria-label="Terms" ref={this.box} checked={this.on} onchange={this.flipped} />
            <input aria-label="Name" ref={this.field} value={this.text} oninput={this.typed} transform={this.keep} />
          </div>
        );
      }
    }
    const app = await getDOM<Terms>(<Terms />);
    await app.settle();

    expect({ messages, on: app.instance.on, text: app.instance.text }).toEqual({ messages: [], on: true, text: "a" });
  });

  /** The same two edits sent by the user, outside a commit, read the model their render wrote. */
  test("two edits outside a commit are not reported", async () => {
    class Shout extends Component {
      @state text = "";
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value.toUpperCase();
      }
      keep(next: string): string {
        return next;
      }
      render() {
        return <input id="i" aria-label="Shout" value={this.text} oninput={this.typed} transform={this.keep} />;
      }
    }
    const app = await getDOM<Shout>(<Shout />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    typeInto(field, "a");
    typeInto(field, `${field.value}b`);
    await app.settle();

    expect({ messages, text: app.instance.text }).toEqual({ messages: [], text: "AB" });
  });
  /** An input method's word, typed by the user, ends outside any commit: nothing to report. */
  test("a word that ends outside a commit is not reported", async () => {
    class Chat extends Component {
      @state text = "x";
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value;
      }
      render() {
        return <input id="i" aria-label="Chat" value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Chat>(<Chat />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "x日本";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    await app.settle();

    expect({ messages, text: app.instance.text }).toEqual({ messages: [], text: "x日本" });
  });
  /**
   * A word the user typed, which a commit's work ended — the browser commits it as a `focus()` moves
   * away. What `oncompositionend` writes still waits for that commit's render, so the read is reported,
   * naming the commit rather than an edit the app sent.
   */
  test("a word typed by the user and ended inside a commit is reported as the commit's", async () => {
    class Chat extends Component {
      @state text = "x";
      @state other = false;
      field = createRef<HTMLInputElement>();
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value;
      }
      render() {
        return (
          <div>
            <input aria-label="Chat" ref={this.field} value={this.text} oninput={this.typed} />
            {this.other ? <Ends field={this.field.current as HTMLInputElement} /> : null}
          </div>
        );
      }
    }
    class Ends extends Component<{ field: HTMLInputElement }> {
      @mounted
      takeTheFocus() {
        this.props.field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
      }
      render() {
        return <span />;
      }
    }
    const app = await getDOM<Chat>(<Chat />);
    await app.settle();
    const field = app.instance.field.current as HTMLInputElement;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "x日本";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    app.instance.other = true;
    await app.settle();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("had its word ended by a commit");
  });

  /** A refused edit ran no handler, so the field still shows its model: a second edit reads it right. */
  test("a second edit after a refused one is not reported", async () => {
    class Locked extends Component {
      @state on = false;
      box = createRef<HTMLInputElement>();
      flipped(event: EventOn<HTMLInputElement>) {
        this.on = event.currentTarget.checked;
      }
      refuse(_next: boolean, prev: boolean): boolean {
        return prev;
      }
      @mounted
      start() {
        this.box.current?.click();
        this.box.current?.click();
      }
      render() {
        return (
          <input
            type="checkbox"
            aria-label="Locked"
            ref={this.box}
            checked={this.on}
            onchange={this.flipped}
            transform={this.refuse}
          />
        );
      }
    }
    const app = await getDOM<Locked>(<Locked />);
    await app.settle();

    expect({ messages, on: app.instance.on }).toEqual({ messages: [], on: false });
  });
  /** No handler ran for the first edit, so nothing waits for a render: the second reads the model. */
  test("a second edit after one no handler heard is not reported", async () => {
    class Unheard extends Component {
      @state text = "";
      prevs: string[] = [];
      field = createRef<HTMLInputElement>();
      changed() {}
      keep(next: string, prev: string): string {
        this.prevs.push(prev);
        return next;
      }
      @mounted
      fill() {
        const field = this.field.current as HTMLInputElement;
        typeInto(field, "x");
        typeInto(field, "xy");
      }
      render() {
        return (
          <input
            aria-label="Unheard"
            ref={this.field}
            value={this.text}
            onchange={this.changed}
            transform={this.keep}
          />
        );
      }
    }
    const app = await getDOM<Unheard>(<Unheard />);
    await app.settle();

    expect({ messages, prevs: app.instance.prevs }).toEqual({ messages: [], prevs: ["", ""] });
  });
});
