import { describe, test, expect } from "vitest";
import { Component } from "../index";
import { state } from "../base/decorators";
import { getDOM } from "../test/setup";

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
