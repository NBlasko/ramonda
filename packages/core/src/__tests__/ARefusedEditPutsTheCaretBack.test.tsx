import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { mounted, state } from "../base/decorators";
import { Component, TextArea, createRef, type EventOn } from "../index";

/**
 * An edit the field does not keep puts the selection back where the edit found it — whoever refused
 * it: a handler that did not write the model, or a field with no handler at all. The field shows the
 * text it had before the edit, so the offsets before the edit mean what they meant; without this, the
 * browser leaves the caret at the end of the text it was handed back.
 */

/** A text area whose handler refuses every edit: it writes nothing. */
class LockedArea extends Component {
  @state text = "hello world";
  typed(_event: EventOn<HTMLTextAreaElement>) {}
  render() {
    return <TextArea id="t" aria-label="Locked" value={this.text} oninput={this.typed} />;
  }
}

/** The same, on a plain `<input>`. */
class LockedInput extends Component {
  @state text = "hello world";
  typed(_event: EventOn<HTMLInputElement>) {}
  render() {
    return <input id="t" aria-label="Locked" value={this.text} oninput={this.typed} />;
  }
}

/** A field with a model and no handler: nothing typed is ever kept. */
class NoHandler extends Component {
  @state text = "hello world";
  render() {
    return <input id="t" aria-label="Fixed" value={this.text} />;
  }
}

type Text = HTMLInputElement | HTMLTextAreaElement;

/** An edit as a browser makes it: `beforeinput` while the selection is still there, then the edit and its `input`. */
function edit(field: Text, from: [number, number], text: string, caret: number, inputType: string): void {
  field.setSelectionRange(from[0], from[1]);
  field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType }));
  field.value = text;
  field.setSelectionRange(caret, caret);
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
}

/** An edit with no `beforeinput` of its own — an `input` dispatched alone. */
function editAlone(field: Text, text: string, caret: number, inputType: string): void {
  field.value = text;
  field.setSelectionRange(caret, caret);
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
}

function shown(field: Text): [string, number | null, number | null] {
  return [field.value, field.selectionStart, field.selectionEnd];
}

describe("a refused edit puts the selection back", () => {
  for (const [name, Locked] of [
    ["a text area", LockedArea],
    ["an input", LockedInput],
  ] as const) {
    /** `world` selected and pasted over with `abc`: `world` is selected again. */
    test(`a paste over a selection that ${name}'s handler refused`, async () => {
      const app = await getDOM(<Locked />);
      await app.settle();
      const field = app.container.querySelector("#t") as Text;
      edit(field, [6, 11], "hello abc", 9, "insertFromPaste");

      expect(shown(field)).toEqual(["hello world", 6, 11]);
    });

    /** `ello` selected and deleted: the selection comes back. */
    test(`a delete over a selection that ${name}'s handler refused`, async () => {
      const app = await getDOM(<Locked />);
      await app.settle();
      const field = app.container.querySelector("#t") as Text;
      edit(field, [1, 5], "h world", 1, "deleteContentBackward");

      expect(shown(field)).toEqual(["hello world", 1, 5]);
    });
  }

  /** `world` selected and typed over with `w`: the inserted letter is the one the selection began with. */
  test("an insert beginning like the selection it replaced puts the whole selection back", async () => {
    const app = await getDOM(<LockedArea />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    edit(field, [6, 11], "hello w", 7, "insertText");

    expect(shown(field)).toEqual(["hello world", 6, 11]);
  });

  /** Backspace after an emoji takes two units and no selection: the caret goes back after it. */
  test("a refused Backspace after an emoji puts the caret back, selecting nothing", async () => {
    const app = await getDOM<LockedArea>(<LockedArea />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    app.instance.text = "hi👍";
    await app.settle();
    edit(field, [4, 4], "hi", 2, "deleteContentBackward");

    expect(shown(field)).toEqual(["hi👍", 4, 4]);
  });

  /** `maxlength` takes part of a paste: what was selected is what the field had then, not a sum. */
  test("a refused paste the field cut short puts back the caret it had", async () => {
    const app = await getDOM<LockedArea>(<LockedArea />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    app.instance.text = "abc";
    await app.settle();
    edit(field, [3, 3], "abc12", 5, "insertFromPaste");

    expect(shown(field)).toEqual(["abc", 3, 3]);
  });

  /** Typed beside the same letter — `l` into `he|llo` — the caret goes back to where it was, not past the pair. */
  test("a refused keystroke beside the same letter puts the caret back where it was", async () => {
    const app = await getDOM(<LockedArea />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    editAlone(field, "helllo world", 3, "insertText");

    expect(shown(field)).toEqual(["hello world", 2, 2]);
  });

  /** Backspace in `hel|lo` takes the `l` BEFORE the caret, which moved to 2: back to 3. */
  test("a delete backward with no beforeinput puts the caret back after what it took", async () => {
    const app = await getDOM(<LockedArea />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    editAlone(field, "helo world", 2, "deleteContentBackward");

    expect(shown(field)).toEqual(["hello world", 3, 3]);
  });

  /** No record of the selection: the caret goes back by what the edit added before it. */
  test("an edit with no beforeinput of its own puts the caret back by what it added", async () => {
    const app = await getDOM(<LockedInput />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    editAlone(field, "heXllo world", 3, "insertText");

    expect(shown(field)).toEqual(["hello world", 2, 2]);
  });

  /**
   * A keystroke's `beforeinput` that no edit followed — a full `maxlength` — and then an autofill with
   * none of its own: the selection recorded was the keystroke's, not the autofill's.
   */
  test("an edit of another kind than the beforeinput before it is put back by what it added", async () => {
    const app = await getDOM(<LockedInput />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    field.setSelectionRange(0, 5);
    field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: "x" }));
    editAlone(field, "hello world!", 12, "insertReplacementText");

    expect(shown(field)).toEqual(["hello world", 11, 11]);
  });

  /** What a delete forward took was after the caret: the caret stays where the edit found it. */
  test("a delete forward with no beforeinput leaves the caret where it was", async () => {
    const app = await getDOM(<LockedInput />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    editAlone(field, "hllo world", 1, "deleteContentForward");

    expect(shown(field)).toEqual(["hello world", 1, 1]);
  });

  test("a field with no handler puts the selection back", async () => {
    const app = await getDOM(<NoHandler />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    edit(field, [6, 11], "hello abc", 9, "insertFromPaste");

    expect(shown(field)).toEqual(["hello world", 6, 11]);
  });

  /** A word the handler refused at its end: the caret goes back to before the word, in the middle of the text. */
  test("a word the handler refused puts the caret back before it", async () => {
    const app = await getDOM(<LockedInput />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    field.setSelectionRange(5, 5);
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "hello日本 world";
    field.setSelectionRange(7, 7);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "日本" }));
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    await app.settle();

    expect(shown(field)).toEqual(["hello world", 5, 5]);
  });

  /** A refusal answered while a commit runs shows the model a microtask later; the selection comes back with it. */
  test("an edit refused while a commit runs puts the selection back once the field shows the model", async () => {
    class Filled extends Component {
      @state text = "hello world";
      field = createRef<HTMLInputElement>();
      typed(_event: EventOn<HTMLInputElement>) {}
      @mounted
      paste() {
        edit(this.field.current as HTMLInputElement, [6, 11], "hello abc", 9, "insertFromPaste");
      }
      render() {
        return <input id="t" aria-label="Filled" ref={this.field} value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM(<Filled />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;

    expect(shown(field)).toEqual(["hello world", 6, 11]);
  });
});

describe("a kept edit leaves the caret where the edit put it", () => {
  test("a handler that took the edit", async () => {
    class Open extends Component {
      @state text = "hello world";
      typed(event: EventOn<HTMLInputElement>) {
        this.text = event.currentTarget.value;
      }
      render() {
        return <input id="t" aria-label="Open" value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM(<Open />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    edit(field, [6, 11], "hello abc", 9, "insertFromPaste");

    expect(shown(field)).toEqual(["hello abc", 9, 9]);
  });

  /** `world` pasted over `world`: the text is what it was, and nothing was refused. */
  test("an edit that left the same text keeps the caret where the paste put it", async () => {
    const app = await getDOM(<LockedInput />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    edit(field, [6, 11], "hello world", 11, "insertFromPaste");

    expect(shown(field)).toEqual(["hello world", 11, 11]);
  });

  /** A handler that rewrote the edit to another length: where the caret belongs is the app's to say. */
  test("a handler that rewrote the edit is not put back to before it", async () => {
    class Upper extends Component {
      @state text = "hello world";
      typed(event: EventOn<HTMLInputElement>) {
        this.text = `${event.currentTarget.value}!`;
      }
      render() {
        return <input id="t" aria-label="Upper" value={this.text} oninput={this.typed} />;
      }
    }
    const app = await getDOM(<Upper />);
    await app.settle();
    const field = app.container.querySelector("#t") as Text;
    edit(field, [6, 11], "hello abc", 9, "insertFromPaste");

    expect(shown(field)).toEqual(["hello abc!", 10, 10]);
  });
});
