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
