import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state } from "../index";

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
 * Known gap, deliberately not tested here: a handler that REJECTS a keystroke
 * (leaving `@state` untouched) schedules no render at all, so nothing re-applies
 * the value. Fixing that means deciding what an input with a `value` and no
 * handler should be, which is a design question, not a defect in this diff.
 */

describe("controlled form values", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("a render re-asserts the model's value on an input the user has typed into", async () => {
    @Host("div")
    class F extends Component {
      @state text = "abc";
      @state tick = 0;

      render() {
        return (
          <div>
            <input value={this.text} />
            <span>{this.tick}</span>
          </div>
        );
      }
    }

    const app = await getDOM<F>(<F />);
    await app.settle();

    const input = app.container.querySelector("input")!;
    expect(input.value).toBe("abc");

    // Typing changes the property; the attribute still reads "abc", which is
    // exactly what the diff used to compare against.
    await app.user.type(input, "d");
    expect(input.value).toBe("abcd");

    app.instance.tick++;
    await app.settle();

    expect(input.value).toBe("abc");
  });

  test("a render re-asserts the model's checked state on a box the user has clicked", async () => {
    @Host("div")
    class F extends Component {
      @state on = false;
      @state tick = 0;

      render() {
        return (
          <div>
            <input type="checkbox" checked={this.on} />
            <span>{this.tick}</span>
          </div>
        );
      }
    }

    const app = await getDOM<F>(<F />);
    await app.settle();

    const box = app.container.querySelector("input")!;
    expect(box.checked).toBe(false);

    await app.user.click(box);
    expect(box.checked).toBe(true);

    app.instance.tick++;
    await app.settle();

    // `checked={false}` is not "no attribute" — it is the model saying OFF.
    expect(box.checked).toBe(false);
  });

  test("the model still reaches a box the user has already touched", async () => {
    @Host("div")
    class F extends Component {
      @state on = false;

      render() {
        return <input type="checkbox" checked={this.on} />;
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
    @Host("div")
    class F extends Component {
      @state text = "abcd";
      @state tick = 0;

      render() {
        return (
          <div>
            <input value={this.text} />
            <span>{this.tick}</span>
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
});
