import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { mounted, state } from "../base/decorators";
import { Component, TextArea, bootstrap, unmount, type EventOn } from "../index";
import { componentAt } from "../core/DiffAndMerge";
import { renderToString } from "../hydration/ssr";
import { flushSync } from "../testing";

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

/** A radio group's default that moves — a refetch, a saved draft — after the user picked, or before. */
describe("a radio group whose default moves", () => {
  class Sizes extends Component {
    @state saved = "a";
    @state sizes = ["a", "b", "c"];
    render() {
      return (
        <div>
          <form>
            <input id="elsewhere" type="radio" name="size" value="elsewhere" />
          </form>
          <form id="sizes">
            <input id="gift" type="radio" name="wrap" value="gift" />
            <input id="box" type="checkbox" name="size" value="box" />
            {this.sizes.map((v) => (
              <input key={v} id={v} type="radio" name="size" value={v} defaultChecked={this.saved === v} />
            ))}
          </form>
        </div>
      );
    }
  }

  /** A step: a click, `reset`, or what the next render holds — the default, and the radios. */
  type Step = string | { saved?: string; sizes?: string[] };

  const moved = async (...steps: Step[]) => {
    const app = await getDOM<Sizes>(<Sizes />);
    await app.settle();
    const form = app.container.querySelector("#sizes") as HTMLFormElement;
    const checked = () =>
      Array.from(form.querySelectorAll<HTMLInputElement>('input[type="radio"][name="size"]'))
        .filter((radio) => radio.checked)
        .map((radio) => radio.id);
    for (const step of steps) {
      if (step === "reset") form.reset();
      else if (typeof step === "string") (app.container.querySelector(`#${step}`) as HTMLInputElement).click();
      else {
        if (step.saved !== undefined) app.instance.saved = step.saved;
        if (step.sizes !== undefined) app.instance.sizes = step.sizes;
        await app.settle();
      }
    }
    const shown = checked();
    form.reset();
    return { shown, reset: checked() };
  };

  test("a pick stays, and a reset returns to the new default — wherever the new default stands", async () => {
    expect(await moved("c", { saved: "b" })).toEqual({ shown: ["c"], reset: ["b"] });
    // Not taken for it: a pick before it in another form, another group or of another kind.
    expect(await moved("elsewhere", "gift", "box", "c", { saved: "b" })).toEqual({ shown: ["c"], reset: ["b"] });
    expect(await moved("a", { saved: "c" })).toEqual({ shown: ["a"], reset: ["c"] });
  });

  test("a pick stays when the new default is a radio the render adds", async () => {
    expect(await moved("c", { saved: "d", sizes: ["d", "b", "c"] })).toEqual({ shown: ["c"], reset: ["d"] });
  });

  test("a pick the render removes leaves the new default checked", async () => {
    expect(await moved("c", { saved: "b", sizes: ["a", "b"] })).toEqual({ shown: ["b"], reset: ["b"] });
  });

  test("before any pick, and after a reset, the default is what the group shows", async () => {
    expect(await moved({ saved: "b" })).toEqual({ shown: ["b"], reset: ["b"] });
    expect(await moved({ saved: "c" }, { saved: "a" })).toEqual({ shown: ["a"], reset: ["a"] });
    expect(await moved("gift", { saved: "b" })).toEqual({ shown: ["b"], reset: ["b"] });
    expect(await moved("c", "reset", { saved: "b" })).toEqual({ shown: ["b"], reset: ["b"] });
  });

  test("a pick in a shadow root stays when the default moves there", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = document.createElement("div");
    host.attachShadow({ mode: "open" }).appendChild(root);
    bootstrap(<Sizes />, root);
    flushSync();
    const radio = (id: string) => root.querySelector(`#${id}`) as HTMLInputElement;
    radio("c").click();
    (componentAt(root) as Sizes).saved = "b";
    flushSync();
    const shown = ["a", "b", "c"].filter((id) => radio(id).checked);
    unmount(root);
    host.remove();
    expect(shown).toEqual(["c"]);
  });

  test("a default that joins no radio group — a box, a radio without a name, the server's — asks no group", async () => {
    class Defaults extends Component {
      @state on = false;
      render() {
        return (
          <div>
            {this.on ? <input type="checkbox" name="size" defaultChecked /> : null}
            {this.on ? <input type="radio" defaultChecked /> : null}
            <input type="checkbox" name="size" defaultChecked={this.on} />
            <input type="radio" defaultChecked={this.on} />
          </div>
        );
      }
    }
    const app = await getDOM<Defaults>(<Defaults />);
    await app.settle();
    const asked: unknown[] = [];
    const queryAll = Document.prototype.querySelectorAll;
    const elementQueryAll = Element.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (this: Document, selector: string) {
      asked.push(selector);
      return queryAll.call(this, selector);
    } as typeof queryAll;
    Element.prototype.querySelectorAll = function (this: Element, selector: string) {
      asked.push(selector);
      return elementQueryAll.call(this, selector);
    } as typeof elementQueryAll;
    try {
      app.instance.on = true;
      await app.settle();
      await renderToString(<Sizes />);
    } finally {
      Document.prototype.querySelectorAll = queryAll;
      Element.prototype.querySelectorAll = elementQueryAll;
    }
    expect(asked).toEqual([]);
  });

  test("a radio a component checks when it mounts in that commit is left as it is", async () => {
    class Chooser extends Component {
      @mounted
      choose() {
        (document.querySelector("#a") as HTMLInputElement).checked = true;
      }
      render() {
        return <output />;
      }
    }
    class Sized extends Sizes {
      override render() {
        return (
          <div>
            {super.render()}
            {this.saved === "b" ? <Chooser /> : null}
          </div>
        );
      }
    }
    const app = await getDOM<Sized>(<Sized />);
    await app.settle();
    (app.container.querySelector("#c") as HTMLInputElement).click();
    app.instance.saved = "b";
    await app.settle();
    const checked = ["a", "b", "c"].filter((id) => (app.container.querySelector(`#${id}`) as HTMLInputElement).checked);
    expect(checked).toEqual(["a"]);
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
    // What bubbles on is the event as the browser made it: nothing the handlers were called with stays on it.
    const touched: boolean[] = [];
    const bubbled = (event: Event) => touched.push(Object.hasOwn(event, "stopImmediatePropagation"));
    app.container.addEventListener("input", bubbled);
    typeInto(field, "x");
    app.instance.second = false;
    await app.settle();
    typeInto(field, "xy");
    app.container.removeEventListener("input", bubbled);

    expect({ calls: app.instance.calls, touched }).toEqual({ calls: ["a", "b", "a"], touched: [false, false] });
  });

  /** One function under both names is called once, as a listener added twice is. */
  test("one function written as `oninput` and `on:input` runs once", async () => {
    class Same extends Component {
      calls = 0;
      counted() {
        this.calls++;
      }
      render() {
        const untyped: Record<string, unknown> = { "on:input": this.counted };
        return <input id="i" aria-label="Same" oninput={this.counted} {...untyped} />;
      }
    }
    const app = await getDOM<Same>(<Same />);
    await app.settle();
    typeInto(app.container.querySelector("#i") as HTMLInputElement, "x");

    expect(app.instance.calls).toBe(1);
  });

  /** A handler the first one takes away — a render it settled dropped it — is not called, as a listener removed mid-dispatch is not. */
  test("`on:input` taken away by `oninput`'s own render is not called", async () => {
    class Drops extends Component {
      @state second = true;
      calls: string[] = [];
      a() {
        this.calls.push("a");
        this.second = false;
        flushSync();
      }
      b() {
        this.calls.push("b");
      }
      render() {
        const untyped: Record<string, unknown> = { "on:input": this.second ? this.b : undefined };
        return <input id="i" aria-label="Drops" oninput={this.a} {...untyped} />;
      }
    }
    const app = await getDOM<Drops>(<Drops />);
    await app.settle();
    typeInto(app.container.querySelector("#i") as HTMLInputElement, "x");

    expect(app.instance.calls).toEqual(["a"]);
  });

  /** The same on a `TextArea`, whose handlers its component calls. */
  test("a TextArea's `on:input` taken away by `oninput`'s own render is not called", async () => {
    class Drops extends Component {
      @state second = true;
      @state text = "";
      calls: string[] = [];
      a(event: EventOn<HTMLTextAreaElement>) {
        this.calls.push("a");
        this.text = event.currentTarget.value;
        this.second = false;
        flushSync();
      }
      b() {
        this.calls.push("b");
      }
      render() {
        const untyped: Record<string, unknown> = { "on:input": this.second ? this.b : undefined };
        return <TextArea id="t" aria-label="Drops" value={this.text} oninput={this.a} {...untyped} />;
      }
    }
    const app = await getDOM<Drops>(<Drops />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.value = "x";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));

    expect(app.instance.calls).toEqual(["a"]);
  });

  /** A handler that stops the event for the rest is the last, as a listener stopping it would be. */
  test("`oninput` stopping the event leaves `on:input` uncalled", async () => {
    class Stops extends Component {
      @state text = "";
      calls: string[] = [];
      guard(event: EventOn<HTMLInputElement>) {
        this.calls.push("guard");
        event.stopImmediatePropagation();
      }
      track() {
        this.calls.push("track");
      }
      render() {
        const untyped: Record<string, unknown> = { "on:input": this.track };
        return <input id="i" aria-label="Stops" value={this.text} oninput={this.guard} {...untyped} />;
      }
    }
    const app = await getDOM<Stops>(<Stops />);
    await app.settle();
    typeInto(app.container.querySelector("#i") as HTMLInputElement, "x");

    expect(app.instance.calls).toEqual(["guard"]);
  });

  /** The same on a `TextArea`, whose handlers its component calls — for an event, and for the word it hands over. */
  test("a TextArea's `oninput` stopping the event leaves `on:input` uncalled — the word handed over too", async () => {
    class Stops extends Component {
      @state text = "";
      calls: string[] = [];
      guard(event: EventOn<HTMLTextAreaElement, InputEvent>) {
        if (event.isComposing) return;
        this.calls.push(`guard ${event.currentTarget.value}`);
        event.stopImmediatePropagation();
      }
      track(event: EventOn<HTMLTextAreaElement, InputEvent>) {
        if (event.isComposing) return;
        this.calls.push(`track ${event.currentTarget.value}`);
      }
      render() {
        const untyped: Record<string, unknown> = { "on:input": this.track };
        return <TextArea id="t" aria-label="Stops" value={this.text} oninput={this.guard} {...untyped} />;
      }
    }
    const app = await getDOM<Stops>(<Stops />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.value = "x";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    // A word, handed to `oninput` at its end as an `input` — a view of the `compositionend`.
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "x日本";
    field.dispatchEvent(
      new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText" }),
    );
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    await app.settle();

    expect(app.instance.calls).toEqual(["guard x", "guard x日本"]);
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
    "a composition whose end removes the field hands the word over before it goes (inside what is removed: %s)",
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

      expect({ removed: !field.isConnected, taken: app.instance.taken }).toEqual({ removed: true, taken: ["日本"] });
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

  /**
   * A browser blurs a focused field as it is removed: its own `onblur` is called, as any element's is
   * — a draft saved on the way out — and the field answers nothing else.
   */
  test.each(["input", "TextArea"] as const)("a %s the tree removed calls its own onblur", async (kind) => {
    class Page extends Component {
      @state open = true;
      @state text = "";
      blurs = 0;
      typed(event: EventOn<HTMLInputElement | HTMLTextAreaElement>) {
        this.text = event.currentTarget.value;
      }
      left() {
        this.blurs++;
      }
      render() {
        if (!this.open) return <div />;
        return (
          <div>
            {kind === "input" ? (
              <input id="i" aria-label="Gone" value={this.text} oninput={this.typed} onblur={this.left} />
            ) : (
              <TextArea id="i" aria-label="Gone" value={this.text} oninput={this.typed} onblur={this.left} />
            )}
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

    expect(app.instance.blurs).toBe(1);
  });

  /**
   * A chat sends and clears in the middle of a word: the step before reached the handler, the app's
   * write wins at the end, and Firefox's `input` after it changes nothing.
   */
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
      heard: ["日本"],
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

/**
 * A word sent and ended inside a running commit — RMD062 — is handed over at its end as well: what the
 * handler made of its steps waits for the render, and a word is never dropped on a guess. Firefox's
 * input after it is matched against the settled field, and reaches no handler.
 */
test("a word that ends inside a commit is handed over at its end, and Firefox's input after it is not", async () => {
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

  expect({ heard: app.instance.heard, shown: field.value }).toEqual({ heard: ["é", "é"], shown: "É" });
});

/** An `<input>` reads the selection at `beforeinput` as a TextArea does, and the app's own handler still runs. */
test("an input puts back the selection a refused paste replaced, and calls the app's onbeforeinput", async () => {
  class Locked extends Component {
    @state text = "hello";
    seen: string[] = [];
    typed(_event: EventOn<HTMLInputElement>) {}
    about(event: EventOn<HTMLInputElement, InputEvent>) {
      this.seen.push(event.inputType);
    }
    render() {
      return <input id="i" aria-label="Locked" value={this.text} oninput={this.typed} onbeforeinput={this.about} />;
    }
  }
  const app = await getDOM<Locked>(<Locked />);
  await app.settle();
  const field = app.container.querySelector("#i") as HTMLInputElement;
  field.focus();
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

/** Round 39. */
describe("what a field answers, and what it does not", () => {
  /** `value=""` on a file input lets the same file be picked again; it is no model to show. */
  test("a file input with a value is not a controlled field", async () => {
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
      class Upload extends Component {
        upload() {}
        render() {
          return <input id="f" type="file" aria-label="Upload" value="" onchange={this.upload} />;
        }
      }
      const app = await getDOM<Upload>(<Upload />);
      await app.settle();
    } finally {
      HTMLInputElement.prototype.addEventListener = original;
    }

    // Heard for its own `change` only, as any uncontrolled field: nothing answers its edits.
    expect(attached).toEqual(["change"]);
  });

  /** A `beforeinput` whose edit never came — cancelled — does not hand its selection to a later edit. */
  test("a cancelled edit's selection is not put back by a later refusal", async () => {
    class Locked extends Component {
      @state text = "hello world";
      typed(_event: EventOn<HTMLInputElement>) {}
      render() {
        return <input id="i" aria-label="Locked" value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Locked>(<Locked />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    field.setSelectionRange(2, 2);
    field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", cancelable: true }));
    // The edit was cancelled: no input. The user moves on, and leaves the field.
    field.dispatchEvent(new FocusEvent("blur"));
    field.value = "hello worldX";
    field.setSelectionRange(12, 12);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));

    expect([field.value, field.selectionStart]).toEqual(["hello world", 11]);
  });

  /** A handler that throws is the error the app sees, even when the render after it throws too. */
  test("a handler's error is not replaced by the render of what it half wrote", async () => {
    class Broken extends Component {
      @state text = "";
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value;
        throw new Error("the handler's own");
      }
      render() {
        if (this.text === "boom") throw new Error("the render's");
        return <input id="i" aria-label="Broken" value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Broken>(<Broken />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    const seen: string[] = [];
    const listener = (event: ErrorEvent) => {
      seen.push(event.error?.message);
      event.preventDefault();
    };
    window.addEventListener("error", listener);
    try {
      field.value = "boom";
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    } finally {
      window.removeEventListener("error", listener);
    }

    expect(seen).toContain("the handler's own");
  });
});

/** The handler returns, and the render of what it wrote throws: that error goes on, and the field shows the model. */
test("a render that throws after the handler leaves the field showing the model", async () => {
  class Broken extends Component {
    @state text = "";
    typed(event: EventOn<HTMLInputElement>) {
      this.text = event.currentTarget.value;
    }
    render() {
      if (this.text === "boom") throw new Error("the render's");
      return <input id="i" aria-label="Broken" value={this.text} oninput={this.typed} />;
    }
  }
  const app = await getDOM<Broken>(<Broken />);
  await app.settle();
  const field = app.container.querySelector("#i") as HTMLInputElement;
  const seen: string[] = [];
  const listener = (event: ErrorEvent) => {
    seen.push(event.error?.message);
    event.preventDefault();
  };
  window.addEventListener("error", listener);
  try {
    field.value = "boom";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  } finally {
    window.removeEventListener("error", listener);
  }

  expect({ seen, shown: field.value }).toEqual({ seen: ["the render's"], shown: "" });
});

/** Round 40. */
describe("a field when the app's code throws, or an edit is not the one announced", () => {
  /** The render of what a throwing handler half wrote throws too: both errors are seen, and the field shows the model. */
  test("the render's error is reported as well, and the field still shows the model", async () => {
    class Broken extends Component {
      @state text = "";
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value;
        throw new Error("the handler's own");
      }
      render() {
        if (this.text === "boom") throw new Error("the render's");
        return <input id="i" aria-label="Broken" value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Broken>(<Broken />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    const seen: string[] = [];
    const listener = (event: ErrorEvent) => {
      seen.push(event.error?.message);
      event.preventDefault();
    };
    window.addEventListener("error", listener);
    try {
      field.value = "boom";
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      window.removeEventListener("error", listener);
    }

    expect([...seen].sort()).toEqual(["the handler's own", "the render's"]);
  });

  /** A mask that throws on what was pasted, before it writes: the field shows the model it never left. */
  test("a handler that throws before it writes leaves the field showing the model", async () => {
    class Masked extends Component {
      @state text = "12";
      typed(event: EventOn<HTMLInputElement>) {
        if (!/^\d*$/.test(event.currentTarget.value)) throw new Error("not digits");
        this.text = event.currentTarget.value;
      }
      render() {
        return <input id="i" aria-label="Masked" value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Masked>(<Masked />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    const listener = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", listener);
    try {
      field.value = "12abc";
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
    } finally {
      window.removeEventListener("error", listener);
    }

    expect({ shown: field.value, model: app.instance.text }).toEqual({ shown: "12", model: "12" });
  });

  /** A keystroke the app cancelled at `beforeinput`, then an autofill: the cancelled selection is not the autofill's. */
  test("a cancelled beforeinput's selection is not put back for a different edit", async () => {
    class Locked extends Component {
      @state text = "hello world";
      typed(_event: EventOn<HTMLInputElement>) {}
      cancel(event: Event) {
        event.preventDefault();
      }
      render() {
        return <input id="i" aria-label="Locked" value={this.text} oninput={this.typed} onbeforeinput={this.cancel} />;
      }
    }
    const app = await getDOM<Locked>(<Locked />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    field.setSelectionRange(2, 2);
    field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText" }));
    field.value = "hello worldX";
    field.setSelectionRange(12, 12);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));

    expect([field.value, field.selectionStart]).toEqual(["hello world", 11]);
  });

  test("a cancelled beforeinput's selection is not put back even for the same kind of edit", async () => {
    class Locked extends Component {
      @state text = "hello world";
      typed(_event: EventOn<HTMLInputElement>) {}
      cancel(event: Event) {
        event.preventDefault();
      }
      render() {
        return <input id="i" aria-label="Locked" value={this.text} oninput={this.typed} onbeforeinput={this.cancel} />;
      }
    }
    const app = await getDOM<Locked>(<Locked />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    field.setSelectionRange(2, 2);
    field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText" }));
    field.value = "hello worldX";
    field.setSelectionRange(12, 12);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));

    expect([field.value, field.selectionStart]).toEqual(["hello world", 11]);
  });
});

/** Round 41. */
describe("a text field's change", () => {
  /** A text field's `change` on blur: its `onchange` runs, and `oninput` is not handed the edit again. */
  test("a text input's change calls onchange and hands oninput nothing again", async () => {
    class Named extends Component {
      @state text = "";
      typedTimes = 0;
      changed = 0;
      typed(event: EventOn<HTMLInputElement>) {
        this.typedTimes++;
        this.text = event.currentTarget.value;
      }
      left() {
        this.changed++;
      }
      render() {
        return <input id="i" aria-label="Named" value={this.text} oninput={this.typed} onchange={this.left} />;
      }
    }
    const app = await getDOM<Named>(<Named />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    typeInto(field, "a");
    await app.settle();
    field.dispatchEvent(new Event("change", { bubbles: true }));

    expect({ typed: app.instance.typedTimes, changed: app.instance.changed }).toEqual({ typed: 1, changed: 1 });
  });
});

/** Round 42. */
describe("a pick whose handler threw, and a change no input carried", () => {
  test("a box whose oninput threw is not picked by its change", async () => {
    class Terms extends Component {
      @state on = false;
      changes = 0;
      fails() {
        throw new Error("the handler's own");
      }
      flip() {
        this.changes++;
        this.on = !this.on;
      }
      render() {
        return (
          <input
            id="c"
            type="checkbox"
            aria-label="Terms"
            checked={this.on}
            oninput={this.fails}
            onchange={this.flip}
          />
        );
      }
    }
    const app = await getDOM<Terms>(<Terms />);
    await app.settle();
    const box = app.container.querySelector("#c") as HTMLInputElement;
    const listener = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", listener);
    try {
      box.click();
      await app.settle();
    } finally {
      window.removeEventListener("error", listener);
    }

    expect({ changes: app.instance.changes, on: app.instance.on, shown: box.checked }).toEqual({
      changes: 0,
      on: false,
      shown: false,
    });
  });

  /** An autofill sets the value and sends only `change`: the handler decides it, as any edit. */
  test("a change that brings a value no input carried is refused as any edit", async () => {
    class Short extends Component {
      @state text = "";
      typed(event: EventOn<HTMLInputElement>) {
        if (event.currentTarget.value.length <= 3) this.text = event.currentTarget.value;
      }
      render() {
        return <input id="i" aria-label="Short" value={this.text} oninput={this.typed} onchange={this.typed} />;
      }
    }
    const app = await getDOM<Short>(<Short />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    field.value = "abcdef";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await app.settle();

    expect({ model: app.instance.text, shown: field.value }).toEqual({ model: "", shown: "" });
  });
});

/** Round 43: the end of a text field's edit, wherever it comes from. */
describe("a change that is an edit, a change that is a tail, and a word inside a commit", () => {
  /** `fireEvent.change`, a password manager: only `change`, and the field's handler is `oninput`. */
  test("a change no input carried reaches oninput, as the field's edit", async () => {
    class Named extends Component {
      @state name = "";
      typed(event: EventOn<HTMLInputElement>) {
        this.name = event.currentTarget.value;
      }
      render() {
        return <input id="i" aria-label="Named" value={this.name} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Named>(<Named />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    field.value = "filled";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await app.settle();

    expect({ model: app.instance.name, shown: field.value }).toEqual({ model: "filled", shown: "filled" });
  });

  /** A date's `input` and `change` come together, here from inside a commit: the change is its tail. */
  test("a picker's change right after its input, inside a commit, is the input's tail", async () => {
    const { mounted, createRef } = await import("../index");
    class Day extends Component {
      @state day = "2026-01-01";
      field = createRef<HTMLInputElement>();
      picks = 0;
      changes = 0;
      picked(event: EventOn<HTMLInputElement>) {
        this.picks++;
        this.day = event.currentTarget.value;
      }
      changed() {
        this.changes++;
      }
      @mounted
      pickNow() {
        const field = this.field.current as HTMLInputElement;
        field.value = "2026-02-02";
        field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
      render() {
        return (
          <input
            id="d"
            type="date"
            aria-label="Day"
            ref={this.field}
            value={this.day}
            oninput={this.picked}
            onchange={this.changed}
          />
        );
      }
    }
    const app = await getDOM<Day>(<Day />);
    await app.settle();

    expect({ picks: app.instance.picks, changes: app.instance.changes, day: app.instance.day }).toEqual({
      picks: 1,
      changes: 1,
      day: "2026-02-02",
    });
  });

  /** Firefox's `input` after the word, sent before a running commit's settle: it is still the word's. */
  test("a word that ends inside a commit is handed over at its end, and Firefox's input right after it is not", async () => {
    const { mounted, createRef } = await import("../index");
    class Words extends Component {
      @state text = "";
      heard: string[] = [];
      field = createRef<HTMLInputElement>();
      typed(event: EventOn<HTMLInputElement>) {
        this.heard.push(event.currentTarget.value);
        this.text = event.currentTarget.value;
      }
      @mounted
      composeNow() {
        const field = this.field.current as HTMLInputElement;
        field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        field.value = "日本";
        field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "日本" }));
        field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
        field.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "日本" }),
        );
      }
      render() {
        return <input id="i" aria-label="Words" ref={this.field} value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Words>(<Words />);
    await app.settle();

    expect(app.instance.heard).toEqual(["日本", "日本"]);
  });
});

/** A single select whose default two options share: it starts on the first, as `select.value` would. */
test("a select's default shared by two options starts on the first", async () => {
  const { Select } = await import("../index");
  class Pick extends Component {
    render() {
      return (
        <Select id="s" aria-label="Pick" defaultValue="">
          <option value="">Choose…</option>
          <option value="a">a</option>
          <option value="" disabled>
            ──
          </option>
        </Select>
      );
    }
  }
  const app = await getDOM<Pick>(<Pick />);
  await app.settle();
  const select = app.container.querySelector("#s") as HTMLSelectElement;

  expect([select.selectedIndex, select.options[2].hasAttribute("selected")]).toEqual([0, false]);
});

/** Round 44: one rule for a `change` — the tail of an answered edit, or an edit of its own. */
describe("a change, on every field", () => {
  /** Typed, then cleared by the app, then autofilled with the same text: the autofill is an edit. */
  test("an old answered edit does not make a later change its tail", async () => {
    class Named extends Component {
      @state name = "";
      typed(event: EventOn<HTMLInputElement>) {
        this.name = event.currentTarget.value;
      }
      render() {
        return <input id="i" aria-label="Named" value={this.name} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Named>(<Named />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    typeInto(field, "abc");
    await app.settle();
    app.instance.name = "";
    await app.settle();
    field.value = "abc";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await app.settle();

    expect({ model: app.instance.name, shown: field.value }).toEqual({ model: "abc", shown: "abc" });
  });

  /** `fireEvent.change` on a select written with `oninput` alone: the pick reaches it. */
  test("a select's change with no input before it reaches oninput", async () => {
    const { Select } = await import("../index");
    class Sizes extends Component {
      @state size = "a";
      picked(event: EventOn<HTMLSelectElement>) {
        this.size = event.currentTarget.value;
      }
      render() {
        return (
          <Select id="s" aria-label="Size" value={this.size} oninput={this.picked}>
            <option value="a">a</option>
            <option value="b">b</option>
          </Select>
        );
      }
    }
    const app = await getDOM<Sizes>(<Sizes />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    select.value = "b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await app.settle();

    expect({ model: app.instance.size, shown: select.value }).toEqual({ model: "b", shown: "b" });
  });

  test("a TextArea's change with no input before it reaches oninput", async () => {
    const { TextArea } = await import("../index");
    class Notes extends Component {
      @state text = "";
      typed(event: EventOn<HTMLTextAreaElement>) {
        this.text = event.currentTarget.value;
      }
      render() {
        return <TextArea id="t" aria-label="Notes" value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Notes>(<Notes />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    field.value = "filled";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await app.settle();

    expect({ model: app.instance.text, shown: field.value }).toEqual({ model: "filled", shown: "filled" });
  });

  /** A change that is an edit reaches `oninput` as the kind of edit an autofill is. */
  test("a change that is an edit reaches oninput as insertReplacementText", async () => {
    class Named extends Component {
      @state name = "";
      kinds: string[] = [];
      typed(event: EventOn<HTMLInputElement, InputEvent>) {
        this.kinds.push(`handler:${event.inputType}`);
        this.name = event.currentTarget.value;
      }
      render() {
        return <input id="i" aria-label="Named" value={this.name} oninput={this.typed} />;
      }
    }
    const app = await getDOM<Named>(<Named />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    field.value = "filled";
    field.dispatchEvent(new Event("change", { bubbles: true }));

    expect(app.instance.kinds).toEqual(["handler:insertReplacementText"]);
  });

  /** What `oninput` stops is asked of an `input` that never was: the real `change` still bubbles. */
  test("oninput stopping its view of a change-edit leaves the real change alone", async () => {
    class Named extends Component {
      @state name = "";
      formHeard = 0;
      typed(event: EventOn<HTMLInputElement>) {
        event.stopPropagation();
        this.name = event.currentTarget.value;
      }
      heard() {
        this.formHeard++;
      }
      render() {
        return (
          <form onchange={this.heard}>
            <input id="i" aria-label="Named" value={this.name} oninput={this.typed} />
          </form>
        );
      }
    }
    const app = await getDOM<Named>(<Named />);
    await app.settle();
    const field = app.container.querySelector("#i") as HTMLInputElement;
    field.value = "filled";
    field.dispatchEvent(new Event("change", { bubbles: true }));

    expect(app.instance.formHeard).toBe(1);
  });
});

/** A multiple select's default, served: the server's DOM has no `multiple` property, the attribute is read. */
test("a served multiple select keeps every default option", async () => {
  const { Select } = await import("../index");
  class Tags extends Component {
    render() {
      return (
        <Select aria-label="Tags" multiple defaultValue={["a", "b"]}>
          <option value="a">a</option>
          <option value="b">b</option>
          <option value="c">c</option>
        </Select>
      );
    }
  }
  // The server's DOM (linkedom) has no `multiple` property on a select — measured, 0.18.13 — so it is
  // taken away here for the render, as the server has it.
  const own = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "multiple");
  Object.defineProperty(HTMLSelectElement.prototype, "multiple", { get: () => undefined, configurable: true });
  let html: string;
  try {
    html = await renderToString(<Tags />);
  } finally {
    if (own !== undefined) Object.defineProperty(HTMLSelectElement.prototype, "multiple", own);
  }
  const marked = html.match(/<option[^>]*selected[^>]*>/g) ?? [];

  expect(marked.length).toBe(2);
});

/** Firefox's `input` after a word inside a commit reaches nothing; a later edit with new text is heard. */
test("an edit after a word that ended inside a commit is heard", async () => {
  const { mounted, createRef } = await import("../index");
  class Words extends Component {
    @state text = "";
    heard: string[] = [];
    field = createRef<HTMLInputElement>();
    typed(event: EventOn<HTMLInputElement>) {
      this.heard.push(event.currentTarget.value);
      this.text = event.currentTarget.value;
    }
    @mounted
    composeNow() {
      const field = this.field.current as HTMLInputElement;
      field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      field.value = "日本";
      field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "日本" }));
      field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "日本" }));
    }
    render() {
      return <input id="i" aria-label="Words" ref={this.field} value={this.text} oninput={this.typed} />;
    }
  }
  const app = await getDOM<Words>(<Words />);
  await app.settle();
  const field = app.container.querySelector("#i") as HTMLInputElement;
  // A later edit of the same kind, which leaves new text in the field.
  field.value = "日本語";
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "語" }));

  expect(app.instance.heard).toEqual(["日本", "日本", "日本語"]);
});

/**
 * A word the app's own write overtook is not handed over at its end; the step before it was an edit the
 * handler took, so the `change` after it, which finds the text moved from where it began, ends it.
 */
test("a word the app's write overtook is not handed over, and its change ends the step the handler took", async () => {
  class Chat extends Component {
    @state text = "x";
    heard: string[] = [];
    typed(event: EventOn<HTMLInputElement>) {
      this.heard.push(`input ${event.currentTarget.value}`);
      this.text = event.currentTarget.value;
    }
    changed(event: EventOn<HTMLInputElement>) {
      this.heard.push(`change ${event.currentTarget.value}`);
    }
    render() {
      return <input id="i" aria-label="Chat" value={this.text} oninput={this.typed} onchange={this.changed} />;
    }
  }
  const app = await getDOM<Chat>(<Chat />);
  await app.settle();
  const field = app.container.querySelector("#i") as HTMLInputElement;
  field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  field.value = "x日";
  field.dispatchEvent(
    new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText" }),
  );
  app.instance.text = "";
  await app.settle();
  field.value = "x日本";
  field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  await app.settle();

  expect({ heard: app.instance.heard, model: app.instance.text, shown: field.value }).toEqual({
    heard: ["input x日", "change "],
    model: "",
    shown: "",
  });
});

/**
 * Edits that put the text back end with the blur — a browser sends no `change` for them — so a later
 * `change`, after the app moved the model, is judged against where its own edits began.
 */
test("a change after edits that were put back, and a model the app moved, reaches onchange", async () => {
  class Notes extends Component {
    @state text = "";
    changes: string[] = [];
    typed(event: EventOn<HTMLInputElement>) {
      this.text = event.currentTarget.value;
    }
    changed(event: EventOn<HTMLInputElement>) {
      this.changes.push(event.currentTarget.value);
    }
    render() {
      return <input id="i" aria-label="Notes" value={this.text} oninput={this.typed} onchange={this.changed} />;
    }
  }
  const app = await getDOM<Notes>(<Notes />);
  await app.settle();
  const field = app.container.querySelector("#i") as HTMLInputElement;
  typeInto(field, "x");
  field.value = "";
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  field.dispatchEvent(new FocusEvent("blur"));
  app.instance.text = "abc";
  await app.settle();
  field.value = "";
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  await app.settle();

  expect(app.instance.changes).toEqual([""]);
});
