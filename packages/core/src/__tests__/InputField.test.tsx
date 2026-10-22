import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component, type EventOn } from "../index";
import { renderToString } from "../hydration/ssr";

/** An edit as a browser makes it: the field changes first, then `input` says so. */
function typeInto(field: HTMLInputElement, text: string) {
  field.value = text;
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
}

/**
 * A plain `<input>` with a `value` or a `checked` is controlled: its own handlers are called by its
 * field listener, which then shows the model — before anything around it reads the field.
 */
describe("a controlled input is answered in its own listener", () => {
  test("a keystroke its handler refuses is gone before a form around it reads the field", async () => {
    const read: string[] = [];
    class Digits extends Component {
      @state phone = "064";
      typed(event: EventOn<HTMLInputElement>) {
        if (/^\d*$/.test(event.currentTarget.value)) this.phone = event.currentTarget.value;
      }
      heard(event: EventOn<HTMLFormElement>) {
        read.push((event.target as HTMLInputElement).value);
      }
      render() {
        return (
          <form oninput={this.heard}>
            <input id="i" value={this.phone} oninput={this.typed} />
          </form>
        );
      }
    }
    const app = await getDOM<Digits>(<Digits />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    typeInto(field, "064a");
    typeInto(field, "0641");

    expect({ read, shown: field.value, model: app.instance.phone }).toEqual({
      read: ["064", "0641"],
      shown: "0641",
      model: "0641",
    });
  });

  test("its handler is called once per edit, and a handler handed over by a render is the one called", async () => {
    const calls: string[] = [];
    class Swapped extends Component {
      @state text = "";
      @state second = false;
      first(event: EventOn<HTMLInputElement>) {
        calls.push(`first ${event.currentTarget.value}`);
        this.text = event.currentTarget.value;
      }
      other(event: EventOn<HTMLInputElement>) {
        calls.push(`other ${event.currentTarget.value}`);
        this.text = event.currentTarget.value;
      }
      render() {
        return <input id="i" value={this.text} oninput={this.second ? this.other : this.first} />;
      }
    }
    const app = await getDOM<Swapped>(<Swapped />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    typeInto(field, "a");
    app.instance.second = true;
    await app.settle();
    typeInto(field, "ab");

    expect(calls).toEqual(["first a", "other ab"]);
  });

  /**
   * A checkbox's click is one edit, `input` then `change`: a handler on `onchange` runs on the
   * `input`, so a render a form's `oninput` causes in between finds the model ticked already.
   */
  test("a render between a checkbox's input and its change does not untick it", async () => {
    class Terms extends Component {
      @state agreed = false;
      @state touched = false;
      ticked(event: EventOn<HTMLInputElement>) {
        this.agreed = event.currentTarget.checked;
      }
      touch() {
        this.touched = true;
      }
      render() {
        return (
          <form oninput={this.touch}>
            <input id="c" type="checkbox" checked={this.agreed} onchange={this.ticked} />
            <span>{String(this.touched)}</span>
          </form>
        );
      }
    }
    const app = await getDOM<Terms>(<Terms />);
    await app.settle();
    const box = app.container.querySelector("#c") as HTMLInputElement;
    box.click();
    await app.settle();

    expect({ checked: box.checked, model: app.instance.agreed, touched: app.instance.touched }).toEqual({
      checked: true,
      model: true,
      touched: true,
    });
  });

  test("a radio its handler refuses puts the whole group back at once", async () => {
    class Pets extends Component {
      @state pet = "a";
      picked(event: EventOn<HTMLInputElement>) {
        if (event.currentTarget.value !== "c") this.pet = event.currentTarget.value;
      }
      render() {
        return (
          <form>
            {["a", "b", "c"].map((pet) => (
              <input
                key={pet}
                id={pet}
                type="radio"
                name="pet"
                value={pet}
                checked={this.pet === pet}
                onchange={this.picked}
              />
            ))}
          </form>
        );
      }
    }
    const app = await getDOM<Pets>(<Pets />);
    await app.settle();
    const radios = Array.from(app.container.querySelectorAll("input"));
    (app.container.querySelector("#c") as HTMLInputElement).click();

    expect(radios.filter((radio) => radio.checked).map((radio) => radio.id)).toEqual(["a"]);
  });
});

/** `defaultValue` and `defaultChecked`: where an uncontrolled input starts, and nothing after. */
describe("an uncontrolled input starts on its default and is the user's", () => {
  test("typing stays, and its handler is called once per edit", async () => {
    const calls: string[] = [];
    class Email extends Component {
      typed(event: EventOn<HTMLInputElement>) {
        calls.push(event.currentTarget.value);
      }
      render() {
        return (
          <form>
            <input id="e" name="email" defaultValue="ana@example.com" oninput={this.typed} />
          </form>
        );
      }
    }
    const app = await getDOM<Email>(<Email />);
    await app.settle();
    const field = app.container.querySelector("#e") as HTMLInputElement;
    const started = field.value;
    typeInto(field, "ana@example.org");
    const typed = field.value;
    (field.form as HTMLFormElement).reset();

    expect({ started, typed, calls, afterReset: field.value }).toEqual({
      started: "ana@example.com",
      typed: "ana@example.org",
      calls: ["ana@example.org"],
      afterReset: "ana@example.com",
    });
  });

  test("a checkbox starts ticked, and clicks are the user's", async () => {
    class News extends Component {
      render() {
        return <input id="n" type="checkbox" defaultChecked />;
      }
    }
    const app = await getDOM<News>(<News />);
    await app.settle();
    const box = app.container.querySelector("#n") as HTMLInputElement;
    const started = box.checked;
    box.click();

    expect({ started, now: box.checked }).toEqual({ started: true, now: false });
  });

  test("a served page carries the default as the attribute, so it shows before any script", async () => {
    class Served extends Component {
      render() {
        return (
          <div>
            <input defaultValue="ana" />
            <input type="checkbox" defaultChecked />
          </div>
        );
      }
    }
    const html = await renderToString(<Served />);

    expect({
      value: /<input[^>]*value="ana"/.test(html),
      checked: /<input[^>]*type="checkbox"[^>]*checked/.test(html),
      noNames: /defaultvalue|defaultchecked/i.test(html),
    }).toEqual({ value: true, checked: true, noNames: false });
  });

  test("a default turned off by a render takes the attribute away", async () => {
    class Toggled extends Component {
      @state on = true;
      render() {
        return <input id="t" type="checkbox" defaultChecked={this.on} />;
      }
    }
    const app = await getDOM<Toggled>(<Toggled />);
    await app.settle();
    const box = app.container.querySelector("#t") as HTMLInputElement;
    const before = box.hasAttribute("checked");
    app.instance.on = false;
    await app.settle();

    expect({ before, after: box.hasAttribute("checked") }).toEqual({ before: true, after: false });
  });
});

/** A default is written once, and a render that does not change it leaves the field alone. */
describe("an uncontrolled input across a render", () => {
  class Survey extends Component {
    @state count = 0;
    render() {
      return (
        <form>
          <output id="count">{this.count}</output>
          <input id="a" type="radio" name="size" value="a" defaultChecked />
          <input id="b" type="radio" name="size" value="b" />
          <input id="note" aria-label="Note" defaultValue="hi" />
        </form>
      );
    }
  }

  test("a radio the user picked stays picked when the page renders for something else", async () => {
    const app = await getDOM<Survey>(<Survey />);
    await app.settle();
    const a = app.container.querySelector("#a") as HTMLInputElement;
    const b = app.container.querySelector("#b") as HTMLInputElement;
    b.click();
    app.instance.count++;
    await app.settle();

    expect({ count: app.container.querySelector("#count")?.textContent, a: a.checked, b: b.checked }).toEqual({
      count: "1",
      a: false,
      b: true,
    });
  });

  test("a render that leaves the defaults as they are writes no attribute of the fields", async () => {
    const app = await getDOM<Survey>(<Survey />);
    await app.settle();
    const written: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) written.push(`${(record.target as Element).id}.${record.attributeName}`);
    });
    for (const id of ["a", "b", "note"]) {
      observer.observe(app.container.querySelector(`#${id}`) as Element, { attributes: true });
    }
    app.instance.count++;
    await app.settle();
    observer
      .takeRecords()
      .forEach((record) => written.push(`${(record.target as Element).id}.${record.attributeName}`));
    observer.disconnect();

    expect(written).toEqual([]);
  });
});

/**
 * Each handler handed to an `<input>` is one of its own, as a listener is. `on:input` is refused by the
 * types; this is a caller they do not reach, through a spread of something untyped.
 */
describe("an input's own handlers", () => {
  class Both extends Component {
    @state second = true;
    calls: string[] = [];
    a() {
      this.calls.push("a");
    }
    b() {
      this.calls.push("b");
    }
    render() {
      const untyped: Record<string, unknown> = { "on:input": this.second ? this.b : undefined };
      return <input id="i" aria-label="Both" oninput={this.a} {...untyped} />;
    }
  }

  test("`oninput` and `on:input` both run, and taking one away leaves the other", async () => {
    const app = await getDOM<Both>(<Both />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    typeInto(field, "x");
    app.instance.second = false;
    await app.settle();
    typeInto(field, "xy");

    expect(app.instance.calls).toEqual(["a", "b", "a"]);
  });

  test("an uncontrolled input is heard only for the events it has a handler for", async () => {
    const attached: string[] = [];
    const original = HTMLInputElement.prototype.addEventListener;
    HTMLInputElement.prototype.addEventListener = function (
      this: HTMLInputElement,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      attached.push(type);
      return original.call(this, type, listener, options);
    } as typeof original;
    try {
      class Blurred extends Component {
        left() {}
        render() {
          return <input aria-label="Blurred" defaultValue="x" onblur={this.left} />;
        }
      }
      const app = await getDOM<Blurred>(<Blurred />);
      await app.settle();
    } finally {
      HTMLInputElement.prototype.addEventListener = original;
    }

    expect(attached).toEqual(["blur"]);
  });
});

/** Round 30: what a controlled `<input>` keeps, whatever is written beside it or happens around it. */
describe("a controlled input keeps its model", () => {
  /** A wrapper passing `defaultValue` straight through hands `undefined` beside the model's `value`. */
  test("a default written as undefined beside `value` leaves the model's attribute", async () => {
    class Wrapped extends Component {
      @state text = "abc";
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value;
      }
      render() {
        return <input id="i" aria-label="Wrapped" value={this.text} defaultValue={undefined} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Wrapped>(<Wrapped />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    typeInto(field, "abcd");
    await app.settle();

    expect({ attribute: field.getAttribute("value"), shown: field.value }).toEqual({
      attribute: "abcd",
      shown: "abcd",
    });
    expect(await renderToString(<Wrapped />)).toContain('value="abc"');
  });

  test("a default written as undefined beside `checked` leaves the model's attribute", async () => {
    class Boxed extends Component {
      kept() {}
      render() {
        return (
          <input
            id="c"
            type="checkbox"
            aria-label="Boxed"
            checked={true}
            defaultChecked={undefined}
            onchange={this.kept}
          />
        );
      }
    }
    const app = await getDOM<Boxed>(<Boxed />);
    await app.settle();
    const box = app.container.querySelector("#c") as HTMLInputElement;
    box.click();

    expect({ attribute: box.hasAttribute("checked"), checked: box.checked }).toEqual({
      attribute: true,
      checked: true,
    });
  });

  /** An autosave flipping a class on every `input` renders the field in the middle of a word. */
  test("a render in the middle of a composition does not write the field", async () => {
    class Saving extends Component {
      @state text = "";
      @state tick = 0;
      typed(event: EventOn<HTMLInputElement, InputEvent>) {
        if (event.isComposing) return;
        this.text = event.currentTarget.value;
      }
      saved() {
        this.tick++;
      }
      render() {
        return (
          <form oninput={this.saved}>
            <input id="i" aria-label="Saving" className={`t${this.tick}`} value={this.text} oninput={this.typed} />
          </form>
        );
      }
    }
    const app = await getDOM<Saving>(<Saving />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "に";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "に" }));
    await app.settle();

    expect({ rendered: field.className, shown: field.value }).toEqual({ rendered: "t1", shown: "に" });
  });

  /** Chromium sends nothing after a composition; the next real edit, leaving the same text, is still heard. */
  test("after a composition, an edit that leaves the same text still reaches the handler", async () => {
    class Words extends Component {
      @state text = "";
      heard: string[] = [];
      typed(event: EventOn<HTMLInputElement, InputEvent>) {
        if (event.isComposing) return;
        this.heard.push(event.currentTarget.value);
        this.text = event.currentTarget.value;
      }
      render() {
        return <input id="i" aria-label="Words" value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Words>(<Words />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "日本";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "日本" }));
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    await app.settle();
    // Select-all and paste the same word: a real edit, as Chromium sends it.
    field.value = "日本";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));

    expect(app.instance.heard).toEqual(["日本", "日本"]);
  });

  /** A radio tied to its form by `form="id"`, from outside the element, is of its group all the same. */
  test("a refused pick puts back a radio of the group that sits outside the form element", async () => {
    class Outside extends Component {
      @state size = "b";
      kept() {}
      render() {
        return (
          <div>
            <form id="f">
              <input
                id="a"
                type="radio"
                name="x"
                value="a"
                aria-label="a"
                checked={this.size === "a"}
                onchange={this.kept}
              />
            </form>
            <input
              id="b"
              type="radio"
              name="x"
              value="b"
              aria-label="b"
              form="f"
              checked={this.size === "b"}
              onchange={this.kept}
            />
          </div>
        );
      }
    }
    const app = await getDOM<Outside>(<Outside />);
    await app.settle();
    const a = app.container.querySelector("#a") as HTMLInputElement;
    const b = app.container.querySelector("#b") as HTMLInputElement;
    // The model holds `b`, outside the form element; `a`, inside, is clicked and refused.
    a.click();

    expect([a.checked, b.checked]).toEqual([false, true]);
  });
});

/** Round 31. */
describe("a field's own handlers, its defaults and its end", () => {
  test("a box whose model turns off, with a default written as undefined beside it, stays off", async () => {
    class Wrapped extends Component {
      @state on = true;
      kept() {}
      render() {
        return (
          <input
            id="c"
            type="checkbox"
            aria-label="Wrapped"
            checked={this.on}
            defaultChecked={undefined}
            onchange={this.kept}
          />
        );
      }
    }
    const app = await getDOM<Wrapped>(<Wrapped />);
    await app.settle();
    const box = app.container.querySelector("#c") as HTMLInputElement;
    app.instance.on = false;
    await app.settle();
    const attribute = box.hasAttribute("checked");
    // The handler leaves the model off: the box shows the model.
    box.click();

    expect({ attribute, checked: box.checked }).toEqual({ attribute: false, checked: false });
  });

  /** Enter closes the dialog the field was in: the word's end removes the field. */
  test.each([false, true])(
    "a composition whose end removes the field hands the word to nobody (inside what is removed: %s)",
    async (wrapped) => {
      class Dialog extends Component<{ wrapped: boolean }> {
        @state open = true;
        @state text = "";
        taken: string[] = [];
        take(event: EventOn<HTMLInputElement, InputEvent>) {
          if (event.isComposing) return;
          this.taken.push(event.currentTarget.value);
          this.text = event.currentTarget.value;
        }
        close() {
          this.open = false;
        }
        render() {
          return (
            <div>
              {this.open && !this.props.wrapped ? (
                <input id="i" aria-label="Dialog" value={this.text} oninput={this.take} oncompositionend={this.close} />
              ) : null}
              {this.open && this.props.wrapped ? (
                <section>
                  <input
                    id="i"
                    aria-label="Dialog"
                    value={this.text}
                    oninput={this.take}
                    oncompositionend={this.close}
                  />
                </section>
              ) : null}
            </div>
          );
        }
      }
      const app = await getDOM<Dialog>(<Dialog wrapped={wrapped} />);
      await app.settle();
      const field = app.container.querySelector("#i") as HTMLInputElement;
      field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      field.value = "日本";
      field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "日本" }));
      field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
      await app.settle();

      expect({ removed: !field.isConnected, taken: app.instance.taken }).toEqual({ removed: true, taken: [] });
    },
  );
});

/** Round 32. */
describe("what a controlled input shows, past a number's spelling, a rewritten word and a lost one", () => {
  /** `1.50` is the model's 1.5: the field keeps the half-typed text, on the edit and on a later render. */
  test("a number field keeps a spelling of the model's number while it is typed", async () => {
    class Amount extends Component {
      @state amount = 1.5;
      @state other = 0;
      typed(event: EventOn<HTMLInputElement>) {
        this.amount = Number(event.currentTarget.value);
      }
      render() {
        return (
          <input
            id="n"
            type="number"
            aria-label="Amount"
            className={`o${this.other}`}
            value={this.amount}
            oninput={this.typed}
          />
        );
      }
    }
    const app = await getDOM<Amount>(<Amount />);
    await app.settle();
    const field = app.container.querySelector("#n") as HTMLInputElement;
    typeInto(field, "1.50");
    await app.settle();
    const afterEdit = field.value;
    app.instance.other++;
    await app.settle();

    expect({ afterEdit, afterRender: field.value }).toEqual({ afterEdit: "1.50", afterRender: "1.50" });
  });

  /** Firefox's `input` after the word carries what the field shows — the handler's rewrite of it. */
  test("a word the handler rewrites is still heard once, with Firefox's input after it", async () => {
    class Shouting extends Component {
      @state text = "";
      heard: string[] = [];
      typed(event: EventOn<HTMLInputElement>) {
        this.heard.push(event.currentTarget.value);
        this.text = event.currentTarget.value.toUpperCase();
      }
      render() {
        return <input id="i" aria-label="Shouting" value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Shouting>(<Shouting />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "é";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "é" }));
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "é" }));
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "é" }));
    await app.settle();

    expect({ heard: app.instance.heard, shown: field.value }).toEqual({ heard: ["é"], shown: "É" });
  });

  /** A browser that sends no `compositionend` after a blur: the field still follows the app's model. */
  test("after a blur in the middle of a word, a model the app clears is shown", async () => {
    class Search extends Component {
      @state text = "";
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value;
      }
      clear() {
        this.text = "";
      }
      render() {
        return <input id="i" aria-label="Search" value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Search>(<Search />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    typeInto(field, "a");
    await app.settle();
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "aに";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "に" }));
    field.dispatchEvent(new FocusEvent("blur"));
    app.instance.clear();
    await app.settle();

    expect({ model: app.instance.text, shown: field.value }).toEqual({ model: "", shown: "" });
  });
});

/** Round 33: a field answering an event fired from inside a drain. */
describe("a field blurred in the middle of a commit", () => {
  test("a dialog whose @mounted takes the focus does not spin the drain", async () => {
    const { mounted, createRef } = await import("../index");
    class Dialog extends Component {
      field = createRef<HTMLInputElement>();
      @mounted
      focusIt() {
        this.field.current?.focus();
      }
      render() {
        return <input id="d" aria-label="Dialog" ref={this.field} />;
      }
    }
    class Other extends Component {
      @mounted
      noted() {}
      render() {
        return <span>other</span>;
      }
    }
    class Page extends Component {
      @state query = "";
      @state open = false;
      blurs = 0;
      typed(event: EventOn<HTMLInputElement>) {
        this.query = event.currentTarget.value;
      }
      left() {
        this.blurs++;
      }
      render() {
        return (
          <div>
            <input id="q" aria-label="Search" value={this.query} oninput={this.typed} onblur={this.left} />
            {this.open ? <Dialog /> : null}
            {this.open ? <Other /> : null}
          </div>
        );
      }
    }
    const app = await getDOM<Page>(<Page />);
    await app.settle();
    const search = app.container.querySelector("#q") as HTMLInputElement;
    search.focus();
    app.instance.open = true;
    await app.settle();

    expect({ focused: document.activeElement?.id, blurs: app.instance.blurs }).toEqual({ focused: "d", blurs: 1 });
  });

  /** A browser blurs a focused field as it is removed: the field's own handler is not called for it. */
  test("a field the tree removed answers its blur with nothing", async () => {
    class Page extends Component {
      @state open = true;
      @state text = "";
      blurs = 0;
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value;
      }
      left() {
        this.blurs++;
      }
      render() {
        return (
          <div>
            {this.open ? (
              <input id="i" aria-label="Gone" value={this.text} oninput={this.typed} onblur={this.left} />
            ) : null}
          </div>
        );
      }
    }
    const app = await getDOM<Page>(<Page />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    app.instance.open = false;
    await app.settle();
    field.dispatchEvent(new FocusEvent("blur"));

    expect(app.instance.blurs).toBe(0);
  });

  /** A chat sends and clears in the middle of a word: Firefox's `input` after its end changes nothing. */
  test("after a word the app's write won over, Firefox's input reaches no handler", async () => {
    class Chat extends Component {
      @state text = "";
      heard: string[] = [];
      typed(event: EventOn<HTMLInputElement>) {
        this.heard.push(event.currentTarget.value);
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
    field.value = "日本";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "日本" }));
    app.instance.text = "sent";
    await app.settle();
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "日本" }));
    await app.settle();

    expect({ heard: app.instance.heard, model: app.instance.text, shown: field.value }).toEqual({
      heard: [],
      model: "sent",
      shown: "sent",
    });
  });
});

/** A radio group's name comes from data: a line break in it is a name like any other. */
test("a form-less radio group whose name holds a line break is put back", async () => {
  class Odd extends Component {
    @state pick = "a";
    kept() {}
    render() {
      return (
        <div>
          <input
            id="a"
            type="radio"
            aria-label="a"
            name={"x\ny"}
            value="a"
            checked={this.pick === "a"}
            onchange={this.kept}
          />
          <input
            id="b"
            type="radio"
            aria-label="b"
            name={"x\ny"}
            value="b"
            checked={this.pick === "b"}
            onchange={this.kept}
          />
        </div>
      );
    }
  }
  const app = await getDOM<Odd>(<Odd />);
  await app.settle();
  const a = app.container.querySelector("#a") as HTMLInputElement;
  const b = app.container.querySelector("#b") as HTMLInputElement;
  b.click();

  expect([a.checked, b.checked]).toEqual([true, false]);
});

/** Round 34: a field answering an event fired inside a commit flushed without a drain. */
describe("a field answering inside a commit", () => {
  test("a blur from a @mounted on the first mount does not spin", async () => {
    const { mounted, createRef } = await import("../index");
    class Searching extends Component {
      @state query = "";
      field = createRef<HTMLInputElement>();
      typed(event: EventOn<HTMLInputElement>) {
        this.query = event.currentTarget.value;
      }
      @mounted
      take() {
        this.field.current?.focus();
      }
      render() {
        return <input id="q" aria-label="Search" ref={this.field} value={this.query} oninput={this.typed} />;
      }
    }
    class Stealing extends Component {
      field = createRef<HTMLInputElement>();
      @mounted
      take() {
        this.field.current?.focus();
      }
      render() {
        return <input id="s" aria-label="Steal" ref={this.field} />;
      }
    }
    class After extends Component {
      @mounted
      noted() {}
      render() {
        return <span>after</span>;
      }
    }
    const app = await getDOM(
      <div>
        <Searching />
        <Stealing />
        <After />
      </div>,
    );
    await app.settle();

    expect(document.activeElement?.id).toBe("s");
  });

  /** A box clicked from a @mounted: what a listener around it reads is the click, not the old model. */
  test("a field clicked from a @mounted is not shown the model before its handler's render", async () => {
    const { mounted, createRef } = await import("../index");
    const read: boolean[] = [];
    class Terms extends Component {
      @state on = false;
      box = createRef<HTMLInputElement>();
      flipped(event: EventOn<HTMLInputElement>) {
        this.on = event.currentTarget.checked;
      }
      heard() {
        read.push(this.box.current?.checked ?? false);
      }
      @mounted
      tick() {
        this.box.current?.click();
      }
      render() {
        return (
          <form onchange={this.heard}>
            <input id="c" type="checkbox" aria-label="Terms" ref={this.box} checked={this.on} onchange={this.flipped} />
          </form>
        );
      }
    }
    const app = await getDOM<Terms>(<Terms />);
    await app.settle();
    const box = app.container.querySelector("#c") as HTMLInputElement;

    expect({ read, model: app.instance.on, shown: box.checked }).toEqual({ read: [true], model: true, shown: true });
  });
});

/** A word ending inside a running commit: Firefox's input after it is matched against the settled field. */
test("a word that ends inside a commit is heard once, with Firefox's input after it", async () => {
  const { mounted, createRef } = await import("../index");
  class Shouting extends Component {
    @state text = "";
    heard: string[] = [];
    field = createRef<HTMLInputElement>();
    typed(event: EventOn<HTMLInputElement>) {
      this.heard.push(event.currentTarget.value);
      this.text = event.currentTarget.value.toUpperCase();
    }
    @mounted
    composeNow() {
      const field = this.field.current as HTMLInputElement;
      field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      field.value = "é";
      field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "é" }));
      field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "é" }));
    }
    render() {
      return <input id="i" aria-label="Shouting" ref={this.field} value={this.text} oninput={this.typed} />;
    }
  }
  const app = await getDOM<Shouting>(<Shouting />);
  await app.settle();
  const field = app.container.querySelector("#i") as HTMLInputElement;
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "é" }));
  await app.settle();

  expect({ heard: app.instance.heard, shown: field.value }).toEqual({ heard: ["é"], shown: "É" });
});

/** An `<input>` reads the selection at `beforeinput` as a TextArea does, and the app's own handler still runs. */
test("an input puts back the selection a refused paste replaced, and calls the app's onbeforeinput", async () => {
  class Locked extends Component {
    @state text = "hello";
    seen: string[] = [];
    typed(event: EventOn<HTMLInputElement>) {
      this.text = event.currentTarget.value;
    }
    about(event: EventOn<HTMLInputElement, InputEvent>) {
      this.seen.push(event.inputType);
    }
    refuse(_next: string, prev: string): string {
      return prev;
    }
    render() {
      return (
        <input
          id="i"
          aria-label="Locked"
          value={this.text}
          oninput={this.typed}
          onbeforeinput={this.about}
          transform={this.refuse}
        />
      );
    }
  }
  const app = await getDOM<Locked>(<Locked />);
  await app.settle();
  const field = app.container.querySelector("#i") as HTMLInputElement;
  field.setSelectionRange(1, 4);
  field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertFromPaste" }));
  field.value = "hXo";
  field.setSelectionRange(2, 2);
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));

  expect({
    shown: [field.value, field.selectionStart, field.selectionEnd],
    seen: app.instance.seen,
  }).toEqual({ shown: ["hello", 1, 4], seen: ["insertFromPaste"] });
});
