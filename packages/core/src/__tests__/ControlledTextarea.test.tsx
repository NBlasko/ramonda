import { describe, test, expect, vi, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component, TextArea, createRef } from "../index";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";

/**
 * A `<textarea>` keeps its value INSIDE the element. HTML gives it no `value` attribute at all, so
 * `<textarea value="hello">` is markup a browser ignores — measured on the parsed output, an EMPTY
 * field that filled itself in when the bundle arrived.
 *
 * `<TextArea value={x}>` writes it as the element's child instead, which is the one place it
 * survives. The attribute pass cannot: it runs BEFORE the children, so a text node written there is
 * one the children pass has never heard of, and it unmounts it as a leftover — measured, `"hello"`
 * at the moment of writing and `<textarea></textarea>` in the finished markup.
 *
 * The plain tag is refused by the types for that reason: nothing written as an attribute can carry
 * this value, and only something that renders the tag can write a child.
 */
class Editor extends Component {
  @state text = "hello";
  render() {
    return <TextArea id="t" value={this.text} />;
  }
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const served = (html: string): HTMLTextAreaElement => {
  const host = document.createElement("div");
  host.innerHTML = html.replace(/<!--[^>]*-->/g, "");
  return host.querySelector("textarea") as HTMLTextAreaElement;
};

describe("what the server sends for a textarea", () => {
  test("the value is inside the element, so a browser shows it before any JS runs", async () => {
    const html = (await renderToString(<Editor />)).replace(/<!--[^>]*-->/g, "");
    expect(html).toBe('<textarea id="t">hello</textarea>');
    expect(served(html).value).toBe("hello");
  });

  test("a defaultValue is inside the element the same way", async () => {
    const html = (await renderToString(<TextArea id="t" defaultValue="start" />)).replace(/<!--[^>]*-->/g, "");
    expect(html).toBe('<textarea id="t">start</textarea>');
    expect(served(html).value).toBe("start");
  });

  /**
   * The value is content now, so it is escaped like content. Written as an attribute it was escaped
   * for a different context entirely, and a value carrying markup is the shape that turns a rendered
   * field into a live element on somebody's page.
   */
  test("a value carrying markup is escaped, not opened", async () => {
    class Hostile extends Component {
      render() {
        return <TextArea id="t" value={'</textarea><img src=x onerror="steal()">'} />;
      }
    }

    const html = (await renderToString(<Hostile />)).replace(/<!--[^>]*-->/g, "");
    const host = document.createElement("div");
    host.innerHTML = html;

    expect(host.querySelectorAll("img").length).toBe(0);
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      '</textarea><img src=x onerror="steal()">',
    );
  });

  test("an empty value sends an empty element rather than nothing at all", async () => {
    class Blank extends Component {
      render() {
        return <TextArea id="t" value="" />;
      }
    }
    const html = (await renderToString(<Blank />)).replace(/<!--[^>]*-->/g, "");
    expect(served(html).value).toBe("");
  });
});

describe("a served textarea, hydrated", () => {
  /**
   * An EMPTY value is no child at all, not a child that is the empty string.
   *
   * The two look identical in the DOM and are not the same tree: the server has nothing to
   * serialize for `""`, so it sends `<textarea></textarea>`, and a client that built an empty text
   * node disagrees with it. It reported RMD007 — *rendered the text "" but the server sent nothing*
   * — on markup both sides were right about, which is the worst kind of report to get.
   */
  test("an empty value is not a mismatch", async () => {
    class Blank extends Component {
      render() {
        return <TextArea id="t" value="" />;
      }
    }

    const captured: string[] = [];
    const handler = (event: Event) => captured.push((event as CustomEvent).detail.message as string);
    window.addEventListener("ramonda:dev-log", handler);

    const html = await renderToString(<Blank />);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;
    captured.length = 0;

    hydrateRoot(<Blank />, container);
    await Promise.resolve();

    window.removeEventListener("ramonda:dev-log", handler);
    const field = container.querySelector("#t") as HTMLTextAreaElement;
    const result = { value: field.value, reported: captured.filter((m) => m.includes("RMD")) };
    container.remove();

    expect(result).toEqual({ value: "", reported: [] });
  });

  test("the reader sees the text before any JS, and it stays after", async () => {
    const html = await renderToString(<Editor />);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    expect((container.querySelector("#t") as HTMLTextAreaElement).value).toBe("hello");

    hydrateRoot(<Editor />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect((container.querySelector("#t") as HTMLTextAreaElement).value).toBe("hello");
    container.remove();
  });
});

describe("a controlled textarea on the client", () => {
  test("follows the model", async () => {
    const app = await getDOM<Editor>(<Editor />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    expect(field.value).toBe("hello");

    app.instance.text = "goodbye";
    await app.settle();
    expect(field.value).toBe("goodbye");
  });

  /**
   * Both halves move together, and the reason they are two halves at all.
   *
   * The child is the DEFAULT value — what the field starts as, and the only thing a served page can
   * carry. The property is what the field IS, and once the reader has typed, the default has stopped
   * driving the element entirely: from then on only the property can put the model back.
   */
  test("the child is the default and the property is what drives the field", async () => {
    const app = await getDOM<Editor>(<Editor />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    expect({ text: field.textContent, value: field.value }).toEqual({ text: "hello", value: "hello" });

    app.instance.text = "goodbye";
    await app.settle();
    expect({ text: field.textContent, value: field.value }).toEqual({ text: "goodbye", value: "goodbye" });

    // What the reader types wins over the default, which is what makes it a default.
    field.value = "typed";
    expect({ text: field.textContent, value: field.value }).toEqual({ text: "goodbye", value: "typed" });
  });

  /** Everything else written on it reaches the element, `data-` and `aria-` included. */
  test("it is transparent", async () => {
    class Dressed extends Component {
      @state wide = true;
      render() {
        return (
          <TextArea
            id="t"
            value="x"
            className={this.wide ? "wide" : "narrow"}
            disabled
            name="notes"
            rows={4}
            data-kind="editor"
            aria-label="notes"
          />
        );
      }
    }

    const app = await getDOM<Dressed>(<Dressed />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    expect({
      cls: field.className,
      disabled: field.disabled,
      name: field.name,
      rows: field.rows,
      kind: field.getAttribute("data-kind"),
      label: field.getAttribute("aria-label"),
    }).toEqual({ cls: "wide", disabled: true, name: "notes", rows: 4, kind: "editor", label: "notes" });

    app.instance.wide = false;
    await app.settle();
    expect(field.className).toBe("narrow");
  });

  /**
   * A caller's own ref, which on `Select` was the bug that silently stopped the component working:
   * one element takes one `ref`, and if the caller's wins, the component never sees its element.
   */
  test("a caller's ref gets the element, and the value is still applied", async () => {
    class Own extends Component {
      mine = createRef<HTMLTextAreaElement>();
      render() {
        return <TextArea id="t" value="held" ref={this.mine} />;
      }
    }

    const app = await getDOM<Own>(<Own />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    expect({ ref: app.instance.mine.current, value: field.value }).toEqual({ ref: field, value: "held" });
  });
});

/**
 * A caller's own ref, and the swap that used to go unnoticed.
 *
 * `TextArea` takes the element's `ref` for itself — one element takes one ref, and a component that
 * loses its own element cannot drive it — so the caller's is handed the node by hand, in `g()`, and
 * `settle()` re-checks it on every update because the element's own ref never changes.
 *
 * **That re-check could not run for a swap, and this suite is what found it.** `arePropsBagsEqual`
 * ignored `ref`, so a render whose ONLY change was the ref was not a props change: the component
 * was never queued, `rawProps` was not even replaced, and the caller's old ref kept pointing at a
 * live node until something else happened to update the field. `Select` has identical code and
 * passed its own version of this test the whole time, because its children are rebuilt on every
 * parent render and it always had another reason to update. A `TextArea` whose value did not change
 * had none.
 *
 * `ref` is compared now. The wasted render that exclusion existed to prevent is reported instead of
 * absorbed — `fresh-object-in-props` at the call site, `RMD061` at runtime — and a stable
 * `ref={this.mine}` costs nothing, because an identical value never notifies.
 */
describe("a caller's own ref on a textarea", () => {
  class Swapping extends Component {
    first = createRef<HTMLTextAreaElement>();
    second = createRef<HTMLTextAreaElement>();
    @state useSecond = false;
    @state text = "hello";
    render() {
      return <TextArea id="t" value={this.text} ref={this.useSecond ? this.second : this.first} />;
    }
  }

  test("gets the element, and the value is still applied", async () => {
    const app = await getDOM<Swapping>(<Swapping />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    expect(app.instance.first.current).toBe(field);
    expect(app.instance.second.current).toBeNull();
    // The component kept its own element, so the model still drives the field.
    expect(field.value).toBe("hello");
  });

  test("a swap is honoured at once: the dropped ref is let go, the new one is handed the node", async () => {
    const app = await getDOM<Swapping>(<Swapping />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    app.instance.useSecond = true;
    await app.settle();

    expect(app.instance.first.current).toBeNull();
    expect(app.instance.second.current).toBe(field);
    // The same element throughout — the component was re-rendered, not rebuilt.
    expect(app.container.querySelector("#t")).toBe(field);
    expect(field.value).toBe("hello");
  });

  /**
   * Dropping the ref entirely, which was invisible for a second reason: `ref` used to be subtracted
   * from the key COUNT on both sides, so `<TextArea ref={r} />` becoming `<TextArea />` read as the
   * same shape.
   */
  test("removing the ref releases it", async () => {
    class Dropping extends Component {
      mine = createRef<HTMLTextAreaElement>();
      @state keep = true;
      render() {
        return this.keep ? <TextArea id="t" value="hello" ref={this.mine} /> : <TextArea id="t" value="hello" />;
      }
    }

    const app = await getDOM<Dropping>(<Dropping />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    expect(app.instance.mine.current).toBe(field);

    app.instance.keep = false;
    await app.settle();

    expect(app.instance.mine.current).toBeNull();
    // The field is still the same element and still driven by the model.
    expect(app.container.querySelector("#t")).toBe(field);
    expect(field.value).toBe("hello");
  });

  /** A stable ref is not a props change, so nothing extra is rendered for it. */
  test("a stable ref costs no render", async () => {
    let renders = 0;
    class Stable extends Component {
      mine = createRef<HTMLTextAreaElement>();
      @state other = 1;
      render() {
        renders++;
        return (
          <div>
            <span>{String(this.other)}</span>
            <TextArea id="t" value="hello" ref={this.mine} />
          </div>
        );
      }
    }

    const app = await getDOM<Stable>(<Stable />);
    await app.settle();
    const before = renders;

    app.instance.other = 2;
    await app.settle();

    // The parent rendered once more; the ref was identical, so it added nothing.
    expect(renders).toBe(before + 1);
    expect(app.instance.mine.current).toBe(app.container.querySelector("#t"));
  });
});

/**
 * The model has the last word: after an event the app handles, the field shows what the model holds.
 * Only after THAT event — a textarea saved on blur keeps every keystroke until `change` — and only
 * after the whole event, so a listener on an ancestor reads what the user typed.
 */
describe("a controlled textarea follows the model after the event the app handles", () => {
  const typed = async (field: HTMLTextAreaElement, text: string, events: string[]) => {
    field.value = text;
    for (const type of events) field.dispatchEvent(new Event(type, { bubbles: true }));
    await answered();
  };

  test.each([
    ["refuses", "a", "a"],
    ["takes it", "typed", "typed"],
  ])("an oninput that %s", async (_how, model, expected) => {
    class Typed extends Component {
      @state text = "a";
      answer() {
        this.text = model;
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.answer} />;
      }
    }
    const app = await getDOM<Typed>(<Typed />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    await typed(field, "typed", ["input"]);
    await app.settle();

    expect(field.value).toBe(expected);
  });

  /**
   * A field whose text is only where it starts takes `defaultValue`: every keystroke stays, the app's
   * handlers run as plain listeners, and a later `defaultValue` does not reach a field the user typed in.
   */
  test("a defaultValue field keeps what the user types", async () => {
    let committed = "";
    class Draft extends Component {
      @state start = "a";
      commit(event: Event) {
        committed = (event.target as HTMLTextAreaElement).value;
      }
      render() {
        return <TextArea id="t" defaultValue={this.start} onchange={this.commit} />;
      }
    }
    const app = await getDOM<Draft>(<Draft />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    expect(field.value).toBe("a");

    await typed(field, "typed", ["input", "change"]);
    await app.settle();
    expect(committed).toBe("typed");
    expect(field.value).toBe("typed");

    app.instance.start = "b";
    await app.settle();
    expect(field.value).toBe("typed");
  });

  /** A `defaultValue` that arrives after the first render — from a load — reaches a field nobody typed in. */
  test("a defaultValue that arrives later fills an untouched field", async () => {
    class Loading extends Component {
      @state saved: string | undefined = undefined;
      render() {
        return <TextArea id="t" defaultValue={this.saved} />;
      }
    }
    const app = await getDOM<Loading>(<Loading />);
    await app.settle();
    app.instance.saved = "loaded";
    await app.settle();

    expect((app.container.querySelector("#t") as HTMLTextAreaElement).value).toBe("loaded");
  });

  /** A `value` with only `onchange`: the model does not move while typing, so each keystroke is undone. */
  test("a value with only onchange is held between keystrokes", async () => {
    class Held extends Component {
      @state text = "a";
      commit() {}
      render() {
        return <TextArea id="t" value={this.text} onchange={this.commit} />;
      }
    }
    const app = await getDOM<Held>(<Held />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    await typed(field, "typed", ["input"]);
    await app.settle();

    expect(field.value).toBe("a");
  });

  /**
   * A composition as each browser delivers it, measured. Both end with `compositionend` after the last
   * composing `input`; only Firefox then sends an ordinary `input` with the word.
   */
  function compose(field: HTMLTextAreaElement, from: string, word: string, browser: "chromium" | "firefox") {
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = from + word;
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: word }));
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: word }));
    if (browser === "firefox") {
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: word }));
    }
  }

  /** Until every settle set so far has run — the one a composition's end sets takes two turns. */
  async function drain(app: { settle(): Promise<void> }) {
    for (let turn = 0; turn < 3; turn++) {
      await answered();
      await app.settle();
    }
  }

  /**
   * The usual handler skips composing input and takes the word from the ordinary `input` after it.
   * Chromium sends none, so core sends it; Firefox sends its own, so core sends nothing — the handler
   * takes the word once, in both.
   */
  for (const browser of ["chromium", "firefox"] as const) {
    test(`a word typed through an input method is taken, once (${browser})`, async () => {
      const taken: string[] = [];
      class Composed extends Component {
        @state text = "a";
        take(event: InputEvent) {
          if (event.isComposing) return;
          this.text = (event.target as HTMLTextAreaElement).value;
          taken.push(this.text);
        }
        render() {
          return <TextArea id="t" value={this.text} oninput={this.take} />;
        }
      }
      const app = await getDOM<Composed>(<Composed />);
      await app.settle();
      const field = app.container.querySelector("#t") as HTMLTextAreaElement;

      compose(field, "a", "か", browser);
      await drain(app);

      expect({ field: field.value, model: app.instance.text, taken }).toEqual({
        field: "aか",
        model: "aか",
        taken: ["aか"],
      });
    });
  }

  /**
   * A handler that takes every input, composing or not, already has the word from the last composing
   * `input`: nothing is sent after the composition, and it runs once with the word.
   */
  test("a handler that took the word during the composition is not called again", async () => {
    const taken: string[] = [];
    class Composed extends Component {
      @state text = "a";
      take(event: InputEvent) {
        this.text = (event.target as HTMLTextAreaElement).value;
        taken.push(this.text);
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.take} />;
      }
    }
    const app = await getDOM<Composed>(<Composed />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    compose(field, "a", "か", "chromium");
    await drain(app);

    expect({ field: field.value, taken }).toEqual({ field: "aか", taken: ["aか"] });
  });

  /**
   * A handler that changes what was typed — upper case, a length limit — shows the change with its
   * own render, in the same task as the keystroke: a browser may paint between tasks, and the field
   * must not show the raw keystroke for a frame.
   */
  test("a handler that changes the input shows it with its render, not a task later", async () => {
    class Upper extends Component {
      @state text = "";
      take(event: InputEvent) {
        this.text = (event.target as HTMLTextAreaElement).value.toUpperCase();
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.take} />;
      }
    }
    const app = await getDOM<Upper>(<Upper />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    field.value = "a";
    field.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await app.settle();

    expect(field.value).toBe("A");
  });

  /**
   * Two keystrokes in one task, before the first one's settle has run — fast typing — and a render in
   * the middle of the second, before the form around has taken it: the second keystroke is kept.
   */
  test("a render in the middle of the next keystroke keeps it", async () => {
    class Formed extends Component {
      @state text = "";
      @state typed = 0;
      render() {
        return (
          <form
            oninput={(event: Event) =>
              (this.text = (event.currentTarget as HTMLFormElement).querySelector("textarea")!.value)
            }
          >
            <TextArea id="t" value={this.text} oninput={() => this.typed++} />
          </form>
        );
      }
    }
    const app = await getDOM<Formed>(<Formed />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    const form = app.container.querySelector("form") as HTMLFormElement;

    field.value = "a";
    field.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await app.settle();
    // The second keystroke reaches the field's own listener, a render lands, then the form's.
    field.value = "ab";
    field.dispatchEvent(new InputEvent("input", { bubbles: false }));
    await app.settle();
    form.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await drain(app);

    expect({ field: field.value, model: app.instance.text }).toEqual({ field: "ab", model: "ab" });
  });

  /**
   * A handler that rewrites in place — upper case — keeps the caret where the user put it, as an
   * `<input>` does: a rewrite of the same length leaves every offset meaning what it meant.
   */
  test("an upper-casing handler leaves the caret where the user typed", async () => {
    class Upper extends Component {
      @state text = "ABC";
      take(event: InputEvent) {
        this.text = (event.target as HTMLTextAreaElement).value.toUpperCase();
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.take} />;
      }
    }
    const app = await getDOM<Upper>(<Upper />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.focus();

    field.value = "AxBC";
    field.setSelectionRange(2, 2);
    field.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await drain(app);

    expect({ value: field.value, caret: field.selectionStart }).toEqual({ value: "AXBC", caret: 2 });
  });

  /** A render that leaves the value as it is — an unrelated prop changed — leaves the user's selection too. */
  test("a render with the same value keeps the user's selection", async () => {
    class Marked extends Component {
      @state text = "hello world";
      @state invalid = false;
      render() {
        return <TextArea id="t" value={this.text} oninput={() => {}} aria-invalid={String(this.invalid)} />;
      }
    }
    const app = await getDOM<Marked>(<Marked />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.focus();
    field.setSelectionRange(6, 11);
    app.instance.invalid = true;
    await app.settle();

    expect([field.selectionStart, field.selectionEnd]).toEqual([6, 11]);
  });

  /**
   * A render in the middle of a composition — an autosave flipping `disabled`, a class from the
   * parent — does not write the model into the field: that would cancel the word being typed.
   */
  test("a render during a composition leaves the word being typed", async () => {
    class Saving extends Component {
      @state text = "a";
      @state saving = false;
      take(event: InputEvent) {
        if (event.isComposing) return;
        this.text = (event.target as HTMLTextAreaElement).value;
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.take} disabled={this.saving} />;
      }
    }
    const app = await getDOM<Saving>(<Saving />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.focus();

    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "aか";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    app.instance.saving = true;
    await app.settle();
    expect(field.value).toBe("aか");

    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "か" }));
    await drain(app);
    expect({ field: field.value, model: app.instance.text }).toEqual({ field: "aか", model: "aか" });
  });

  /**
   * A composition that loses its field — a blur, and no `compositionend` after it — is over: the
   * field shows the model again by itself, and after it is focused again it follows the model as any
   * field does.
   */
  test("a composition lost to a blur ends, and the field follows the model again", async () => {
    class Lost extends Component {
      @state text = "a";
      keep(event: InputEvent) {
        if (event.isComposing) return;
        this.text = "a";
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.keep} />;
      }
    }
    const app = await getDOM<Lost>(<Lost />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.focus();

    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "aか";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    field.blur();
    await drain(app);
    const afterBlur = field.value;

    field.focus();
    field.value = "ax";
    field.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await drain(app);

    expect({ afterBlur, afterTyping: field.value }).toEqual({ afterBlur: "a", afterTyping: "a" });
  });

  /**
   * A browser may commit the word on a blur, sending `blur` before `compositionend`: a render in
   * between — an `onblur` that moves the model, a placeholder for an empty field — must not write the
   * model over the word being committed.
   */
  test("a blur before compositionend does not lose the word being committed", async () => {
    class Committed extends Component {
      @state text = "";
      @state touched = false;
      take(event: Event) {
        if ((event as InputEvent).isComposing) return;
        this.text = (event.target as HTMLTextAreaElement).value;
      }
      render() {
        return (
          <TextArea
            id="t"
            value={this.text}
            oninput={this.take}
            oncompositionend={this.take}
            onblur={() => {
              this.touched = true;
              if (this.text === "") this.text = "-";
            }}
          />
        );
      }
    }
    const app = await getDOM<Committed>(<Committed />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.focus();

    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "日本";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    field.blur();
    await app.settle();
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    await drain(app);

    expect({ field: field.value, model: app.instance.text }).toEqual({ field: "日本", model: "日本" });
  });

  /**
   * A handler that takes composing input and CHANGES it — full-width digits to half-width, a trim —
   * leaves the model unlike the field, and still took the word: it is not called again.
   */
  test("a handler that took the word and changed it is not called again", async () => {
    const taken: string[] = [];
    class Postcode extends Component {
      @state text = "";
      take(event: InputEvent) {
        this.text = (event.target as HTMLTextAreaElement).value.replace(/[０-９]/g, (d) =>
          String.fromCharCode(d.charCodeAt(0) - 0xfee0),
        );
        taken.push(this.text);
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.take} />;
      }
    }
    const app = await getDOM<Postcode>(<Postcode />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    compose(field, "", "１２３", "chromium");
    await drain(app);

    expect({ field: field.value, taken }).toEqual({ field: "123", taken: ["123"] });
  });

  /**
   * As a browser does it: the app renders between the composing input and the composition's end. A
   * handler that took the word and changed it moved the model, and is not called again; one that
   * cleared the model mid-word is not handed the word back.
   */
  test("a handler that changed the word is not called again, with a render in between", async () => {
    const taken: string[] = [];
    class Postcode extends Component {
      @state text = "";
      take(event: InputEvent) {
        this.text = (event.target as HTMLTextAreaElement).value.replace(/[０-９]/g, (d) =>
          String.fromCharCode(d.charCodeAt(0) - 0xfee0),
        );
        taken.push(this.text);
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.take} />;
      }
    }
    const app = await getDOM<Postcode>(<Postcode />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "１２３";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    await app.settle();
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "１２３" }));
    await drain(app);

    expect({ field: field.value, taken }).toEqual({ field: "123", taken: ["123"] });
  });

  /**
   * A composition that ends where it began — the word typed again over itself, or cancelled — still
   * moved the model on the way for a handler that takes every input, and it is not called again.
   */
  test("a model that moved and came back is not handed the word again", async () => {
    const taken: string[] = [];
    class Again extends Component {
      @state text = "日本";
      take(event: InputEvent) {
        this.text = (event.target as HTMLTextAreaElement).value;
        taken.push(this.text);
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.take} />;
      }
    }
    const app = await getDOM<Again>(<Again />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    for (const step of ["n", "日本"]) {
      field.value = step;
      field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
      await app.settle();
    }
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    await drain(app);

    expect(taken).toEqual(["n", "日本"]);
  });

  test("a model cleared in the middle of a word is not handed the word back", async () => {
    class Clearing extends Component {
      @state text = "a";
      take(event: InputEvent) {
        if (event.isComposing) return;
        this.text = (event.target as HTMLTextAreaElement).value;
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.take} />;
      }
    }
    const app = await getDOM<Clearing>(<Clearing />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "aか";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    app.instance.text = "";
    await app.settle();
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "か" }));
    await drain(app);

    expect({ field: field.value, model: app.instance.text }).toEqual({ field: "", model: "" });
  });

  /**
   * A field taken OFF the page but kept — a portal parked while its dialog is closed — still hands
   * the word over: the component is alive, and opening the dialog again shows what was typed.
   */
  test("a field moved off the page as its composition ends still takes the word", async () => {
    class Editor extends Component {
      @state text = "";
      take(event: InputEvent) {
        if (event.isComposing) return;
        this.text = (event.target as HTMLTextAreaElement).value;
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.take} />;
      }
    }
    const app = await getDOM<Editor>(<Editor />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    const parked = document.createDocumentFragment();

    compose(field, "", "日本", "chromium");
    parked.appendChild(field);
    await drain(app);

    expect({ field: field.value, model: app.instance.text }).toEqual({ field: "日本", model: "日本" });
  });

  /** A field its composition's end destroyed — Enter closed the dialog — is sent nothing. */
  test("a field destroyed as its composition ends is sent nothing", async () => {
    const taken: string[] = [];
    class Dialog extends Component {
      @state text = "";
      @state open = true;
      take(event: InputEvent) {
        if (event.isComposing) return;
        taken.push((event.target as HTMLTextAreaElement).value);
      }
      close() {
        this.open = false;
      }
      render() {
        return (
          <div>
            {this.open ? <TextArea id="t" value={this.text} oninput={this.take} oncompositionend={this.close} /> : null}
          </div>
        );
      }
    }
    const app = await getDOM<Dialog>(<Dialog />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    compose(field, "", "日本", "chromium");
    await drain(app);

    expect({ onPage: field.isConnected, taken }).toEqual({ onPage: false, taken: [] });
  });

  /**
   * An input method builds a character over several `input` events; putting the old value back
   * between them cancels it. When the composition ends the field shows the model again: a handler
   * that refuses the word has it put back then.
   */
  test("a composition is left alone, and settled when it ends", async () => {
    class Composed extends Component {
      @state text = "a";
      keep(event: InputEvent) {
        if (event.isComposing) return;
        this.text = "a";
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.keep} />;
      }
    }
    const app = await getDOM<Composed>(<Composed />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "ka";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    await drain(app);
    expect(field.value).toBe("ka");

    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "か" }));
    await drain(app);
    expect(field.value).toBe("a");
  });

  /**
   * A composition the field stopped being controlled in the middle of — its end goes to the app, not
   * to core — does not leave the field waiting for an end it will never hear.
   */
  test("a field that lets go during a composition is settled again once it holds a value", async () => {
    class Reloaded extends Component {
      @state text: string | null = "a";
      keep() {
        if (this.text !== null) this.text = "a";
      }
      render() {
        return <TextArea id="t" value={this.text as never} oninput={this.keep} />;
      }
    }
    const app = await getDOM<Reloaded>(<Reloaded />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    app.instance.text = null;
    await app.settle();
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "か" }));
    app.instance.text = "a";
    await app.settle();

    field.value = "ax";
    field.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await answered();
    await app.settle();

    expect(field.value).toBe("a");
  });

  /** A settle set by a keystroke just before a composition began does not land in the middle of it. */
  test("a settle that comes due mid-composition waits", async () => {
    class Composed extends Component {
      @state text = "a";
      keep(event: InputEvent) {
        if (event.isComposing) return;
        this.text = "a";
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.keep} />;
      }
    }
    const app = await getDOM<Composed>(<Composed />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    // A composition happens in the focused field.
    field.focus();

    field.value = "ax";
    field.dispatchEvent(new InputEvent("input", { bubbles: true }));
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "axk";
    await answered();
    await app.settle();

    expect(field.value).toBe("axk");
  });

  /**
   * The word taken on `oncompositionend` — where a handler that skips composing input takes it — is
   * kept, and a blur straight after does not undo it: `change` is not answered.
   */
  test("a word taken on compositionend is kept through a blur", async () => {
    class Composed extends Component {
      @state text = "a";
      take(event: Event) {
        if ((event as InputEvent).isComposing) return;
        this.text = (event.target as HTMLTextAreaElement).value;
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.take} oncompositionend={this.take} />;
      }
    }
    const app = await getDOM<Composed>(<Composed />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "aか";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "か" }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await answered();
    await app.settle();

    expect({ field: field.value, model: app.instance.text }).toEqual({ field: "aか", model: "aか" });
  });

  /** A value that is still `null` is no value: the field is not held, and shows nothing until it has one. */
  test("a null value is no value", async () => {
    class Loading extends Component {
      @state text: string | null = null;
      render() {
        return <TextArea id="t" value={this.text as never} />;
      }
    }
    const app = await getDOM<Loading>(<Loading />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    expect(field.value).toBe("");

    await typed(field, "typed", ["input"]);
    await app.settle();
    expect(field.value).toBe("typed");
  });

  /** A handler that removes the field leaves nothing to settle, and nothing is reported. */
  test("a field its handler removes is left alone", async () => {
    const codes: string[] = [];
    globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => codes.push(record.code);
    class Inline extends Component {
      @state editing = true;
      @state text = "a";
      done(event: Event) {
        this.text = (event.target as HTMLTextAreaElement).value;
        this.editing = false;
      }
      render() {
        return this.editing ? <TextArea id="t" value={this.text} oninput={this.done} /> : <p>{this.text}</p>;
      }
    }
    try {
      const app = await getDOM<Inline>(<Inline />);
      await app.settle();
      await typed(app.container.querySelector("#t") as HTMLTextAreaElement, "typed", ["input"]);
      await app.settle();

      expect(app.container.textContent).toBe("typed");
      expect(codes).toEqual([]);
    } finally {
      globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
    }
  });

  test("a listener on an ancestor reads what the user typed", async () => {
    let seen = "";
    class Wrapped extends Component {
      @state text = "a";
      keep() {
        this.text = "a";
      }
      sync(event: Event) {
        seen = (event.target as HTMLTextAreaElement).value;
      }
      render() {
        return (
          <form oninput={this.sync}>
            <TextArea id="t" value={this.text} oninput={this.keep} />
          </form>
        );
      }
    }
    const app = await getDOM<Wrapped>(<Wrapped />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    await typed(field, "typed", ["input"]);
    await app.settle();

    expect(seen).toBe("typed");
    expect(field.value).toBe("a");
  });

  /** The model moved by a handler on an element around the field: the field keeps what was typed. */
  test("a handler on an ancestor that moves the model keeps the input", async () => {
    class Form extends Component {
      @state text = "a";
      sync(event: Event) {
        this.text = (event.target as HTMLTextAreaElement).value;
      }
      render() {
        return (
          <form oninput={this.sync}>
            <TextArea id="t" value={this.text} />
          </form>
        );
      }
    }
    const app = await getDOM<Form>(<Form />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    await typed(field, "typed", ["input"]);
    await app.settle();

    expect(field.value).toBe("typed");
    expect(app.instance.text).toBe("typed");
  });

  test("a handler that throws still has the model's value put back", async () => {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    class Strict extends Component {
      @state text = "a";
      check() {
        throw new Error("refused");
      }
      render() {
        return <TextArea id="t" value={this.text} oninput={this.check} />;
      }
    }
    try {
      const app = await getDOM<Strict>(<Strict />);
      await app.settle();
      const field = app.container.querySelector("#t") as HTMLTextAreaElement;
      await typed(field, "typed", ["input"]);
      await app.settle();

      expect(field.value).toBe("a");
      expect(errors).toHaveLength(1);
    } finally {
      window.removeEventListener("error", onError);
    }
  });
});

/** The answer to an event comes in the next frame, before it is drawn: wait for that frame, and a task after it. */
function answered(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
