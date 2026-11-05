import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state } from "../index";

/**
 * `value` and `checked` are LIVE PROPERTIES, and the attribute stops speaking for
 * them the moment a user touches the control.
 *
 * Typing into an input changes `input.value`; it does not change the `value`
 * ATTRIBUTE. Clicking a checkbox sets its "dirty checkedness" flag, after which
 * the `checked` attribute no longer drives `input.checked` at all. So an
 * attribute-only diff compares the model against a stale record of what the model
 * said last time, agrees with itself, and writes nothing — while the screen shows
 * something the model never said.
 *
 * That is what these tests pin: when the model and the control disagree, a render
 * makes the control follow the model. The last test pins the other side of it —
 * an unchanged value must NOT be rewritten, because writing `.value` moves the
 * caret to the end, and a control that jumps on every unrelated render is its own
 * bug.
 *
 * A control with a `value` or a `checked` and no handler of its own shows the
 * model the moment it is touched — the field answers the edit in its own listener
 * (`answerEdit` in `core/field.ts`) — and a render after that still writes the
 * model whenever it moves.
 */

describe("controlled form values", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("a render re-asserts the model's value on an input the user has typed into", async () => {
    class F extends Component {
      @state text = "abc";
      @state tick = 0;

      render() {
        return (
          <div>
            <div>
              <input value={this.text} />
              <span>{this.tick}</span>
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<F>(<F />);
    await app.settle();

    const input = app.container.querySelector("input")!;
    expect(input.value).toBe("abc");

    // Typing changes the property, and the field puts the model back at once: no handler moved it.
    await app.user.type(input, "d");
    expect(input.value).toBe("abc");

    app.instance.tick++;
    await app.settle();

    expect(input.value).toBe("abc");
  });

  test("a render re-asserts the model's checked state on a box the user has clicked", async () => {
    class F extends Component {
      @state on = false;
      @state tick = 0;

      render() {
        return (
          <div>
            <div>
              <input type="checkbox" checked={this.on} />
              <span>{this.tick}</span>
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<F>(<F />);
    await app.settle();

    const box = app.container.querySelector("input")!;
    expect(box.checked).toBe(false);

    await app.user.click(box);
    expect(box.checked).toBe(false);

    app.instance.tick++;
    await app.settle();

    // `checked={false}` is not "no attribute" — it is the model saying OFF.
    expect(box.checked).toBe(false);
  });

  test("the model still reaches a box the user has already touched", async () => {
    class F extends Component {
      @state on = false;

      render() {
        return (
          <div>
            <input type="checkbox" checked={this.on} />
          </div>
        );
      }
    }

    const app = await getDOM<F>(<F />);
    await app.settle();

    const box = app.container.querySelector("input")!;

    // The click sets the dirty-checkedness flag: from here on the attribute is
    // inert and only the property can move the box.
    await app.user.click(box);

    app.instance.on = true;
    await app.settle();
    expect(box.checked).toBe(true);

    app.instance.on = false;
    await app.settle();
    expect(box.checked).toBe(false);
  });

  test("a value that did not change is not rewritten, so the caret stays put", async () => {
    class F extends Component {
      @state text = "abcd";
      @state tick = 0;

      render() {
        return (
          <div>
            <div>
              <input value={this.text} />
              <span>{this.tick}</span>
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<F>(<F />);
    await app.settle();

    const input = app.container.querySelector("input")!;
    input.setSelectionRange(1, 1);

    app.instance.tick++;
    await app.settle();

    // Writing `.value` — even the same string — sends the caret to the end.
    expect(input.value).toBe("abcd");
    expect(input.selectionStart).toBe(1);
  });

  test("a radio group follows the model, including after the user picks another", async () => {
    /**
     * Radios have their own rule: checking one UNCHECKS its group, and the
     * browser does that itself. So the model has to win over a click the app
     * never accepted — and the attribute cannot do it, for the same
     * dirty-checkedness reason a single checkbox cannot.
     */
    class F extends Component {
      @state picked = "a";
      @state tick = 0;

      render() {
        return (
          <form>
            <div data-tick={String(this.tick)}>
              <input id="a" type="radio" name="g" value="a" checked={this.picked === "a"} />
              <input id="b" type="radio" name="g" value="b" checked={this.picked === "b"} />
              <input id="c" type="radio" name="g" value="c" checked={this.picked === "c"} />
            </div>
          </form>
        );
      }
    }

    const app = await getDOM<F>(<F />);
    await app.settle();

    const a = app.container.querySelector("#a") as HTMLInputElement;
    const b = app.container.querySelector("#b") as HTMLInputElement;
    const c = app.container.querySelector("#c") as HTMLInputElement;
    const picked = () => [a, b, c].filter((input) => input.checked).map((input) => input.id);

    expect(picked()).toEqual(["a"]);

    app.instance.picked = "b";
    await app.settle();
    expect(picked()).toEqual(["b"]);

    // The user picks a third; the model never agreed, so the group is put back at once.
    await app.user.click(c);
    expect(picked()).toEqual(["b"]);

    app.instance.tick++;
    await app.settle();
    expect(picked()).toEqual(["b"]);

    app.instance.picked = "a";
    await app.settle();
    expect(picked()).toEqual(["a"]);
  });
});
