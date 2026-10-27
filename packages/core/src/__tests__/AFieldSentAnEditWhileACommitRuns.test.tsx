import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { mounted, state } from "../base/decorators";
import { Component, bootstrap, createRef, unmount, type EventOn } from "../index";
import { flushSync } from "../testing";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD062 — a field sent an edit while a commit runs.
 *
 * A field learns its model through render, and the render an edit's handler causes runs once the
 * commit is over. One edit sent from a `@mounted` is answered like any; a second reads the model
 * before that render — whether the handler took the first edit or refused it is not known yet — and
 * so does the check after `oncompositionend`. That read is reported; the edit is still answered.
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
  test("a second edit from a @mounted is reported", async () => {
    class Shout extends Component {
      @state text = "";
      field = createRef<HTMLInputElement>();
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value.toUpperCase();
      }
      @mounted
      fill() {
        const field = this.field.current as HTMLInputElement;
        typeInto(field, "a");
        typeInto(field, `${field.value}b`);
      }
      render() {
        return <input aria-label="Shout" ref={this.field} value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Shout>(<Shout />);
    await app.settle();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("its next event");
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
    expect(messages[0]).toContain("its next event");
  });

  /** One edit from a @mounted reads nothing its render has not written: it is answered, and says nothing. */
  test("one click, or one edit, from a @mounted is not reported", async () => {
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
      @mounted
      start() {
        this.box.current?.click();
        typeInto(this.field.current as HTMLInputElement, "a");
      }
      render() {
        return (
          <div>
            <input type="checkbox" aria-label="Terms" ref={this.box} checked={this.on} onchange={this.flipped} />
            <input aria-label="Name" ref={this.field} value={this.text} oninput={this.typed} />
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
      render() {
        return <input id="i" aria-label="Shout" value={this.text} oninput={this.typed} />;
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
  test("a word typed by the user and ended inside a commit is not reported", async () => {
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

    expect({ messages, text: app.instance.text }).toEqual({ messages: [], text: "x日本" });
  });

  /**
   * `flushSync` runs the commit's renders, and the settle still waits for its microtask: an event sent
   * right after it finds the field showing the model, reads nothing ahead of a render, and a refused
   * edit's `change` reaches no `onchange`.
   */
  test("an event right after flushSync finds the field showing the model", () => {
    let changes = 0;
    class Locked extends Component {
      @state text = "";
      field = createRef<HTMLInputElement>();
      typed(_event: EventOn<HTMLInputElement>) {}
      changed() {
        changes++;
      }
      @mounted
      fill() {
        typeInto(this.field.current as HTMLInputElement, "ab");
      }
      render() {
        return (
          <input aria-label="Locked" ref={this.field} value={this.text} oninput={this.typed} onchange={this.changed} />
        );
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(<Locked />, container);
    flushSync();
    const field = container.querySelector("input") as HTMLInputElement;
    field.dispatchEvent(new Event("change", { bubbles: true }));

    expect({ messages, shown: field.value, changes }).toEqual({ messages: [], shown: "", changes: 0 });
    unmount(container);
    container.remove();
  });

  /**
   * An edit the handler took inside the mount, and another sent right after it, before any microtask:
   * the second is answered against what the field last showed — a render now would write over the
   * browser's edit already in the field — and reported. Once it settles, nothing is left of the guess:
   * the `change` after it is the end of the edits, not an edit of its own.
   */
  test("an edit right after a mount builds on the edit the mount's handler took", () => {
    const heard: string[] = [];
    class Words extends Component {
      @state text = "";
      field = createRef<HTMLInputElement>();
      typed(event: EventOn<HTMLInputElement, InputEvent>) {
        heard.push(`${event.inputType} ${event.currentTarget.value}`);
        this.text = event.currentTarget.value;
      }
      left(event: EventOn<HTMLInputElement>) {
        heard.push(`change ${event.currentTarget.value}`);
      }
      @mounted
      fill() {
        typeInto(this.field.current as HTMLInputElement, "a");
      }
      render() {
        return (
          <input aria-label="Words" ref={this.field} value={this.text} oninput={this.typed} onchange={this.left} />
        );
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(<Words />, container);
    const field = container.querySelector("input") as HTMLInputElement;
    typeInto(field, `${field.value}b`);
    field.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();

    expect({ heard, shown: field.value, reported: messages.some((m) => m.includes("its next event")) }).toEqual({
      heard: ["insertText a", "insertText ab", "change ab"],
      shown: "ab",
      reported: true,
    });
    unmount(container);
    container.remove();
  });

  /** An autofill's `change` right after a mount brings its own text: it is an edit, not the end of the last. */
  test("a change that brings new text right after a mount is answered as an edit", () => {
    const heard: string[] = [];
    class Named extends Component {
      @state text = "";
      field = createRef<HTMLInputElement>();
      typed(event: EventOn<HTMLInputElement, InputEvent>) {
        heard.push(`${event.inputType} ${event.currentTarget.value}`);
        this.text = event.currentTarget.value;
      }
      @mounted
      fill() {
        typeInto(this.field.current as HTMLInputElement, "a");
      }
      render() {
        return <input aria-label="Named" ref={this.field} value={this.text} oninput={this.typed} />;
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(<Named />, container);
    const field = container.querySelector("input") as HTMLInputElement;
    field.value = "filled";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();

    expect({ heard, shown: field.value }).toEqual({
      heard: ["insertText a", "insertReplacementText filled"],
      shown: "filled",
    });
    unmount(container);
    container.remove();
  });

  /** The handler ran and refused: that is known once its render has run, so a second edit reads ahead of it. */
  test("a second edit after one the handler refused is reported", async () => {
    class Locked extends Component {
      @state on = false;
      box = createRef<HTMLInputElement>();
      notYet(_event: EventOn<HTMLInputElement>) {}
      @mounted
      start() {
        this.box.current?.click();
        this.box.current?.click();
      }
      render() {
        return <input type="checkbox" aria-label="Locked" ref={this.box} checked={this.on} onchange={this.notYet} />;
      }
    }
    const app = await getDOM<Locked>(<Locked />);
    await app.settle();

    expect({ messages: messages.length, on: app.instance.on, checked: app.instance.box.current?.checked }).toEqual({
      messages: 1,
      on: false,
      checked: false,
    });
  });
  /** No handler ran for the first edit, so nothing waits for a render: the second reads the model. */
  test("a second edit after one no handler heard is not reported", async () => {
    class Unheard extends Component {
      @state text = "";
      field = createRef<HTMLInputElement>();
      changed() {}
      @mounted
      fill() {
        const field = this.field.current as HTMLInputElement;
        typeInto(field, "x");
        typeInto(field, "xy");
      }
      render() {
        return <input aria-label="Unheard" ref={this.field} value={this.text} onchange={this.changed} />;
      }
    }
    const app = await getDOM<Unheard>(<Unheard />);
    await app.settle();

    expect({ messages, shown: app.instance.field.current?.value }).toEqual({ messages: [], shown: "" });
  });
});
