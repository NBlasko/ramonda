import { describe, test, expect } from "vitest";
import { Component, list } from "../index";
import { state } from "../base/decorators";
import { getDOM } from "../test/setup";
import { renderToString } from "../hydration/ssr";

/**
 * Where the caret is after a controlled field's model rewrites what was typed.
 *
 * Assigning `.value` drops the selection to the END of the field — the platform's doing, not this
 * framework's. For most writes it never shows, because a value only reaches the writer when it
 * DIFFERS from what the element holds: a model that echoes back what the reader typed writes
 * nothing, and the caret is never touched. The first test below is that case, and it is the common
 * one.
 *
 * What is left is a model that REWRITES — uppercasing, a mask, a number formatter — and there the
 * reader typing in the middle of the text finds the next keystroke at the end.
 *
 * The fix is deliberately narrow: the caret is restored when the rewrite left the LENGTH unchanged,
 * because then every offset still means what it meant. When the length changed, the old offset
 * points somewhere new, and the framework does not guess — deciding where the caret belongs after
 * `1,234` becomes `12,345` needs to know which characters are separators, which is the app's
 * knowledge. The third test pins that we leave it alone rather than moving it somewhere wrong.
 */
class Field extends Component<{ id: string; transform: (text: string) => string; start: string }> {
  @state text = this.props.start;
  onInput(event: Event) {
    this.text = this.props.transform((event.target as HTMLInputElement).value);
  }
  render() {
    return <input id={this.props.id} value={this.text} oninput={this.onInput} />;
  }
}

/** Types one character at `at`, the way a reader clicking into the middle of a field does. */
async function typeInTheMiddle(
  app: { container: Element; settle: () => Promise<unknown> },
  id: string,
  at: number,
  character: string,
) {
  const field = app.container.querySelector(`#${id}`) as HTMLInputElement;
  field.value = field.value.slice(0, at) + character + field.value.slice(at);
  field.setSelectionRange(at + 1, at + 1);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await app.settle();
  return { value: field.value, caret: field.selectionStart };
}

describe("the caret in a controlled field", () => {
  /**
   * Nothing is written at all here, which is why nothing moves. The model hands back exactly what
   * the element already holds, so the writer never runs — the reason this whole problem is smaller
   * than it looks.
   */
  test("a model that echoes the input never touches the caret", async () => {
    const app = await getDOM<Field>(<Field id="echo" start="abc" transform={(text) => text} />);
    await app.settle();

    expect(await typeInTheMiddle(app, "echo", 1, "x")).toEqual({ value: "axbc", caret: 2 });
  });

  /**
   * A rewrite that maps character to character. Every offset still means the same position, so the
   * caret goes back where the reader put it — before this, it was at 4 and the next letter typed
   * landed at the end of the word.
   */
  test("a rewrite of the same length puts the caret back", async () => {
    const app = await getDOM<Field>(<Field id="upper" start="ABC" transform={(text) => text.toUpperCase()} />);
    await app.settle();

    expect(await typeInTheMiddle(app, "upper", 1, "x")).toEqual({ value: "AXBC", caret: 2 });
  });

  /**
   * And the case we deliberately do NOT fix, asserted so that nobody adds a guess later without
   * meaning to. `1,234` with a `5` typed at the end becomes `12,345`: a character was inserted
   * before the caret, so the offset the reader left is no longer the position they left. The caret
   * stays where the browser put it — at the end, which here is also where the reader was.
   *
   * An app that formats has to place it itself, reading `selectionStart` in `@updated` and applying
   * its own rule for what counts as a character.
   */
  test("a rewrite that changes the length is left to the app", async () => {
    const app = await getDOM<Field>(
      <Field
        id="money"
        start="123"
        transform={(text) => text.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
      />,
    );
    await app.settle();

    // `1234` typed becomes `1,234`: one character longer, so every offset after the separator moved.
    expect(await typeInTheMiddle(app, "money", 3, "4")).toEqual({ value: "1,234", caret: 5 });
  });

  /**
   * What the fix costs, pinned so that moving it out of the `value` branch is a failing test rather
   * than something nobody notices.
   *
   * A render that touches anything else on the page — an attribute, a class, text — pays NOTHING,
   * because the work sits inside the branch a differing value reaches. When a value IS written the
   * cost is one caret read and one `setSelectionRange`, one for one with the write that was already
   * happening: measured across fifty fields, fifty of each and not fifty-one.
   */
  test("nothing is read or called on a render that does not write a value", async () => {
    class Fields extends Component {
      @state rows = Array.from({ length: 10 }, (_, index) => ({ id: index, text: `row ${index}` }));
      @state tick = 0;
      render() {
        return (
          <div data-tick={String(this.tick)}>
            {list(this.rows, (row) => (
              <input key={row.id} value={row.text} />
            ))}
          </div>
        );
      }
    }

    const app = await getDOM<Fields>(<Fields />);
    await app.settle();

    const counts = { caretReads: 0, ranges: 0 };
    const caret = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "selectionStart")!;
    const range = HTMLInputElement.prototype.setSelectionRange;
    Object.defineProperty(HTMLInputElement.prototype, "selectionStart", {
      ...caret,
      get(this: HTMLInputElement) {
        counts.caretReads++;
        return caret.get?.call(this);
      },
    });
    HTMLInputElement.prototype.setSelectionRange = function (this: HTMLInputElement, ...args) {
      counts.ranges++;
      return range.apply(this, args as never);
    };

    try {
      // A render that changes an attribute on the parent and nothing about the fields.
      app.instance.tick = 1;
      await app.settle();
      expect(counts).toEqual({ caretReads: 0, ranges: 0 });

      // And one that rewrites every field: one read and one call each, not one per render.
      app.instance.rows = app.instance.rows.map((row) => ({ ...row, text: row.text.toUpperCase() }));
      await app.settle();
      expect(counts).toEqual({ caretReads: 10, ranges: 10 });
    } finally {
      Object.defineProperty(HTMLInputElement.prototype, "selectionStart", caret);
      HTMLInputElement.prototype.setSelectionRange = range;
    }
  });

  /**
   * A NUMERIC model, which is what `value={this.count}` gives.
   *
   * The DOM stringifies a number on assignment, so a rewrite of `1234` to `1235` is a rewrite of the
   * same length and the caret is as worth keeping as anywhere else. An earlier version demanded a
   * string on both sides and left every numeric model out without saying so: measured on this same
   * edit, caret 3 with a string model and 5 with a numeric one.
   */
  test("a numeric model keeps the caret too", async () => {
    class Clamped extends Component {
      @state code = 1234;
      onInput(event: Event) {
        const digits = (event.target as HTMLInputElement).value.replace(/\D/g, "");
        this.code = Number([...digits].map((digit) => String(Math.min(Number(digit), 5))).join("")) || 0;
      }
      render() {
        return <input id="clamped" value={this.code} oninput={this.onInput} />;
      }
    }

    const app = await getDOM<Clamped>(<Clamped />);
    await app.settle();

    // A `9` typed in the middle, clamped to `5` — same length, one character apart.
    expect(await typeInTheMiddle(app, "clamped", 2, "9")).toEqual({ value: "12534", caret: 3 });
  });

  /**
   * A server render has no caret, and asks for none. Twenty fields cost twenty reads of
   * `selectionStart` for an answer that can only be `null`, which is the kind of thing that is
   * invisible until somebody counts it.
   */
  test("a server render reads no caret at all", async () => {
    class Page extends Component {
      render() {
        return (
          <div>
            {[1, 2, 3].map((n) => (
              <input key={n} value={`row ${n}`} />
            ))}
          </div>
        );
      }
    }

    let reads = 0;
    const caret = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "selectionStart")!;
    Object.defineProperty(HTMLInputElement.prototype, "selectionStart", {
      ...caret,
      get(this: HTMLInputElement) {
        reads++;
        return caret.get?.call(this);
      },
    });

    try {
      const html = await renderToString(<Page />);
      expect(html).toContain('value="row 1"');
      expect(reads).toBe(0);
    } finally {
      Object.defineProperty(HTMLInputElement.prototype, "selectionStart", caret);
    }
  });

  /**
   * A field with no caret at all. `setSelectionRange` throws on `number`, `email`, `date` and
   * `color`, so a value written to one of those must not take the render down with it.
   */
  test("a field whose type has no selection is written without complaint", async () => {
    class Numeric extends Component {
      @state amount = "1";
      render() {
        return <input id="n" type="number" value={this.amount} />;
      }
    }

    const app = await getDOM<Numeric>(<Numeric />);
    await app.settle();

    app.instance.amount = "2";
    await app.settle();

    expect((app.container.querySelector("#n") as HTMLInputElement).value).toBe("2");
  });
});
