import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { mounted, state } from "../base/decorators";
import { Component, Select, TextArea, createRef, type EventOn, type TransformInput } from "../index";

/**
 * What a controlled field does with each event a browser sends it, for every kind of field, written
 * as one table: which of the field's handlers is called, with what, and what the transform is asked.
 * Every row is run twice — sent from the test, and sent from a `@mounted` while a commit is running,
 * where the field's settle waits for a microtask — and both runs must read the same.
 */

type Kind = "text" | "number" | "date" | "textarea" | "checkbox" | "radio" | "select" | "multiple";
/** Which of `oninput` and `onchange` the field is written with. */
type Handlers = "both" | "oninput" | "onchange";
type AnyField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const START: Record<Kind, string | boolean | string[]> = {
  text: "a",
  number: "1",
  date: "2026-01-01",
  textarea: "a",
  checkbox: false,
  radio: false,
  select: "a",
  multiple: ["a"],
};

/** A field's value as the record writes it: `on`/`off` for a box, the choices joined for a multiple select. */
function read(field: AnyField): string {
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
    return field.checked ? "on" : "off";
  }
  if (field instanceof HTMLSelectElement && field.multiple) {
    return Array.from(field.selectedOptions, (option) => option.value).join(",");
  }
  return field.value;
}

function modelOf(field: AnyField): string | boolean | string[] {
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) return field.checked;
  if (field instanceof HTMLSelectElement && field.multiple) return Array.from(field.selectedOptions, (o) => o.value);
  return field.value;
}

/* The events, as a browser sends them. */

function typeText(field: AnyField, text: string, inputType = "insertText"): void {
  field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType }));
  field.value = text;
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
}

function change(field: AnyField): void {
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

/** A pick: a box clicked, or a select's option chosen — `input`, then `change`, at once. */
function pick(field: AnyField): void {
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
    field.click();
    return;
  }
  if (field instanceof HTMLSelectElement) {
    if (field.multiple) field.options[1].selected = true;
    else field.value = "b";
  } else {
    field.value = "2026-02-02";
  }
  field.dispatchEvent(new Event("input", { bubbles: true }));
  change(field);
}

/** A `change` no `input` came before: an autofill, `fireEvent.change`. */
function changeAlone(field: AnyField): void {
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
    field.checked = !field.checked;
  } else if (field instanceof HTMLSelectElement) {
    if (field.multiple) field.options[1].selected = true;
    else field.value = "b";
  } else if (field instanceof HTMLInputElement && field.type === "date") {
    field.value = "2026-02-02";
  } else if (field instanceof HTMLInputElement && field.type === "number") {
    field.value = "12";
  } else {
    field.value = "filled";
  }
  change(field);
}

/** A word an input method builds; Firefox sends an `input` of its own after `compositionend`. */
function compose(field: AnyField, firefox: boolean, blurMidWord = false): void {
  field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  field.value = "a日";
  field.dispatchEvent(
    new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText" }),
  );
  if (blurMidWord) field.dispatchEvent(new FocusEvent("blur"));
  field.value = "a日本";
  field.dispatchEvent(
    new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText" }),
  );
  field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
  if (firefox) field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText" }));
}

interface Row {
  kind: Kind;
  handlers: Handlers;
  /** The transform refuses every edit. */
  refuse?: boolean;
  events: (field: AnyField) => void;
}

interface Seen {
  /** Each handler call: the event type the handler was handed, its `inputType`, and the field's value. */
  calls: string[];
  /** Each `inputType` the transform was asked about; `none` for a pick, whose event carries none. */
  decided: string[];
  shown: string;
  model: string;
}

async function run(row: Row, inACommit: boolean): Promise<Seen> {
  const { kind, handlers, refuse = false, events } = row;
  class Field extends Component {
    @state model = START[kind];
    calls: string[] = [];
    decided: string[] = [];
    field = createRef<AnyField>();
    edited(event: EventOn<AnyField>) {
      const inputType = (event as Event as InputEvent).inputType;
      this.calls.push(`${event.type}${inputType ? ` ${inputType}` : ""} ${read(event.currentTarget)}`);
      this.model = modelOf(event.currentTarget);
    }
    /** Refuses every edit when the row says so, and always a text that ends in `!`. */
    decide<T>(next: T, prev: T, input: TransformInput): T {
      this.decided.push(input.inputType || "none");
      return refuse || (typeof next === "string" && next.endsWith("!")) ? prev : next;
    }
    @mounted
    sendInside() {
      if (inACommit) events(this.field.current as AnyField);
    }
    render() {
      const oninput = handlers === "onchange" ? undefined : this.edited;
      const onchange = handlers === "oninput" ? undefined : this.edited;
      const model = this.model;
      if (kind === "textarea") {
        return (
          <TextArea
            aria-label="Field"
            ref={this.field as never}
            value={model as string}
            oninput={oninput}
            onchange={onchange}
            transform={this.decide}
          />
        );
      }
      if (kind === "select" || kind === "multiple") {
        return (
          <Select
            aria-label="Field"
            ref={this.field as never}
            multiple={kind === "multiple"}
            value={model as string | string[]}
            oninput={oninput}
            onchange={onchange}
            transform={this.decide}
          >
            <option value="a">a</option>
            <option value="b">b</option>
            <option value="c">c</option>
          </Select>
        );
      }
      if (kind === "checkbox" || kind === "radio") {
        return (
          <input
            type={kind}
            name="r"
            value="b"
            aria-label="Field"
            ref={this.field as never}
            checked={model as boolean}
            oninput={oninput}
            onchange={onchange}
            transform={this.decide}
          />
        );
      }
      return (
        <input
          type={kind}
          aria-label="Field"
          ref={this.field as never}
          value={model as string}
          oninput={oninput}
          onchange={onchange}
          transform={this.decide}
        />
      );
    }
  }
  const app = await getDOM<Field>(<Field />);
  await app.settle();
  const field = app.instance.field.current as AnyField;
  if (!inACommit) events(field);
  await app.settle();
  const model = app.instance.model;
  return {
    calls: app.instance.calls,
    decided: app.instance.decided,
    shown: read(field),
    model: typeof model === "boolean" ? (model ? "on" : "off") : Array.isArray(model) ? model.join(",") : model,
  };
}

const ROWS: Record<string, Row> = {};
const TYPED: Partial<Record<Kind, string>> = { text: "ab", number: "12", textarea: "ab" };

const SCENARIOS: Record<string, { kinds: Kind[]; events: (field: AnyField) => void }> = {
  typed: { kinds: ["text", "number", "textarea"], events: (f) => typeText(f, TYPED[kindOf(f)] as string) },
  "typed, then blurred": {
    kinds: ["text", "number", "textarea"],
    events: (f) => {
      typeText(f, TYPED[kindOf(f)] as string);
      change(f);
    },
  },
  "typed, then a keystroke refused, then blurred": {
    kinds: ["text", "textarea"],
    events: (f) => {
      typeText(f, "ab");
      typeText(f, "ab!");
      change(f);
    },
  },
  "typed, then blurred twice": {
    kinds: ["text", "number", "textarea"],
    events: (f) => {
      typeText(f, TYPED[kindOf(f)] as string);
      change(f);
      change(f);
    },
  },
  "picked, then a change with nothing new": {
    kinds: ["checkbox", "radio", "select", "multiple"],
    events: (f) => {
      pick(f);
      change(f);
    },
  },
  "picked, then a change alone": {
    kinds: ["checkbox", "select"],
    events: (f) => {
      pick(f);
      if (f instanceof HTMLSelectElement) f.value = "c";
      else (f as HTMLInputElement).checked = false;
      change(f);
    },
  },
  "a change with nothing new": {
    kinds: ["text", "number", "textarea", "date", "checkbox", "radio", "select", "multiple"],
    events: change,
  },
  "typed, blurred with no change, then a keystroke refused and a change": {
    kinds: ["text", "textarea"],
    events: (f) => {
      typeText(f, "ab");
      f.dispatchEvent(new FocusEvent("blur"));
      typeText(f, "ab!");
      change(f);
    },
  },
  "1.0 over 1 as an input method's input, not composing": {
    kinds: ["number"],
    events: (f) => typeText(f, "1.0", "insertCompositionText"),
  },
  "the same text pasted": { kinds: ["text", "textarea"], events: (f) => typeText(f, f.value, "insertFromPaste") },
  "1.0 typed over 1": { kinds: ["number"], events: (f) => typeText(f, "1.0") },
  picked: { kinds: ["date", "checkbox", "radio", "select", "multiple"], events: pick },
  "a change alone": {
    kinds: ["text", "number", "textarea", "date", "checkbox", "radio", "select", "multiple"],
    events: changeAlone,
  },
  "a word, Chromium": { kinds: ["text", "textarea"], events: (f) => compose(f, false) },
  "a word, Firefox": { kinds: ["text", "textarea"], events: (f) => compose(f, true) },
  "a word, then blurred": {
    kinds: ["text", "textarea"],
    events: (f) => {
      compose(f, false);
      change(f);
    },
  },
  "a word lost to a blur, Firefox": { kinds: ["text", "textarea"], events: (f) => compose(f, true, true) },
};

function kindOf(field: AnyField): Kind {
  if (field instanceof HTMLTextAreaElement) return "textarea";
  if (field instanceof HTMLSelectElement) return field.multiple ? "multiple" : "select";
  return field.type as Kind;
}

for (const [scenario, { kinds, events }] of Object.entries(SCENARIOS)) {
  for (const kind of kinds) {
    // Only `onchange` on a text field, a date, a time, a color or a range is refused by `@ramonda/check`
    // (`field-the-user-cannot-change`): the `input` before its `change` is answered without it.
    const picks = kind === "checkbox" || kind === "radio" || kind === "select" || kind === "multiple";
    for (const handlers of (picks ? ["both", "oninput", "onchange"] : ["both", "oninput"]) as Handlers[]) {
      for (const refuse of [false, true]) {
        ROWS[`${kind}, ${handlers}${refuse ? ", refusing" : ""}: ${scenario}`] = { kind, handlers, refuse, events };
      }
    }
  }
}

/**
 * Row | the handler calls, in order: the event type each was handed, its `inputType`, the field's value |
 * each `inputType` the transform was asked | the model after, which the field shows.
 */
const TABLE = `
text, both: typed                                                                                 | input insertText ab                                              | insertText                  | ab
text, both, refusing: typed                                                                       | –                                                                | insertText                  | a
text, oninput: typed                                                                              | input insertText ab                                              | insertText                  | ab
text, oninput, refusing: typed                                                                    | –                                                                | insertText                  | a
number, both: typed                                                                               | input insertText 12                                              | insertText                  | 12
number, both, refusing: typed                                                                     | –                                                                | insertText                  | 1
number, oninput: typed                                                                            | input insertText 12                                              | insertText                  | 12
number, oninput, refusing: typed                                                                  | –                                                                | insertText                  | 1
textarea, both: typed                                                                             | input insertText ab                                              | insertText                  | ab
textarea, both, refusing: typed                                                                   | –                                                                | insertText                  | a
textarea, oninput: typed                                                                          | input insertText ab                                              | insertText                  | ab
textarea, oninput, refusing: typed                                                                | –                                                                | insertText                  | a
text, both: typed, then blurred                                                                   | input insertText ab, change ab                                   | insertText                  | ab
text, both, refusing: typed, then blurred                                                         | –                                                                | insertText                  | a
text, oninput: typed, then blurred                                                                | input insertText ab                                              | insertText                  | ab
text, oninput, refusing: typed, then blurred                                                      | –                                                                | insertText                  | a
number, both: typed, then blurred                                                                 | input insertText 12, change 12                                   | insertText                  | 12
number, both, refusing: typed, then blurred                                                       | –                                                                | insertText                  | 1
number, oninput: typed, then blurred                                                              | input insertText 12                                              | insertText                  | 12
number, oninput, refusing: typed, then blurred                                                    | –                                                                | insertText                  | 1
textarea, both: typed, then blurred                                                               | input insertText ab, change ab                                   | insertText                  | ab
textarea, both, refusing: typed, then blurred                                                     | –                                                                | insertText                  | a
textarea, oninput: typed, then blurred                                                            | input insertText ab                                              | insertText                  | ab
textarea, oninput, refusing: typed, then blurred                                                  | –                                                                | insertText                  | a
text, both: typed, then a keystroke refused, then blurred                                         | input insertText ab, change ab                                   | insertText, insertText      | ab
text, both, refusing: typed, then a keystroke refused, then blurred                               | –                                                                | insertText, insertText      | a
text, oninput: typed, then a keystroke refused, then blurred                                      | input insertText ab                                              | insertText, insertText      | ab
text, oninput, refusing: typed, then a keystroke refused, then blurred                            | –                                                                | insertText, insertText      | a
textarea, both: typed, then a keystroke refused, then blurred                                     | input insertText ab, change ab                                   | insertText, insertText      | ab
textarea, both, refusing: typed, then a keystroke refused, then blurred                           | –                                                                | insertText, insertText      | a
textarea, oninput: typed, then a keystroke refused, then blurred                                  | input insertText ab                                              | insertText, insertText      | ab
textarea, oninput, refusing: typed, then a keystroke refused, then blurred                        | –                                                                | insertText, insertText      | a
text, both: the same text pasted                                                                  | input insertFromPaste a                                          | insertFromPaste             | a
text, both, refusing: the same text pasted                                                        | input insertFromPaste a                                          | insertFromPaste             | a
text, oninput: the same text pasted                                                               | input insertFromPaste a                                          | insertFromPaste             | a
text, oninput, refusing: the same text pasted                                                     | input insertFromPaste a                                          | insertFromPaste             | a
textarea, both: the same text pasted                                                              | input insertFromPaste a                                          | insertFromPaste             | a
textarea, both, refusing: the same text pasted                                                    | input insertFromPaste a                                          | insertFromPaste             | a
textarea, oninput: the same text pasted                                                           | input insertFromPaste a                                          | insertFromPaste             | a
textarea, oninput, refusing: the same text pasted                                                 | input insertFromPaste a                                          | insertFromPaste             | a
number, both: 1.0 typed over 1                                                                    | input insertText 1.0                                             | insertText                  | 1.0
number, both, refusing: 1.0 typed over 1                                                          | –                                                                | insertText                  | 1
number, oninput: 1.0 typed over 1                                                                 | input insertText 1.0                                             | insertText                  | 1.0
number, oninput, refusing: 1.0 typed over 1                                                       | –                                                                | insertText                  | 1
date, both: picked                                                                                | input 2026-02-02, change 2026-02-02                              | none                        | 2026-02-02
date, both, refusing: picked                                                                      | –                                                                | none                        | 2026-01-01
date, oninput: picked                                                                             | input 2026-02-02                                                 | none                        | 2026-02-02
date, oninput, refusing: picked                                                                   | –                                                                | none                        | 2026-01-01
checkbox, both: picked                                                                            | input on, change on                                              | none                        | on
checkbox, both, refusing: picked                                                                  | –                                                                | none                        | off
checkbox, oninput: picked                                                                         | input on                                                         | none                        | on
checkbox, oninput, refusing: picked                                                               | –                                                                | none                        | off
checkbox, onchange: picked                                                                        | change on                                                        | none                        | on
checkbox, onchange, refusing: picked                                                              | –                                                                | none                        | off
radio, both: picked                                                                               | input on, change on                                              | none                        | on
radio, both, refusing: picked                                                                     | –                                                                | none                        | off
radio, oninput: picked                                                                            | input on                                                         | none                        | on
radio, oninput, refusing: picked                                                                  | –                                                                | none                        | off
radio, onchange: picked                                                                           | change on                                                        | none                        | on
radio, onchange, refusing: picked                                                                 | –                                                                | none                        | off
select, both: picked                                                                              | input b, change b                                                | none                        | b
select, both, refusing: picked                                                                    | –                                                                | none                        | a
select, oninput: picked                                                                           | input b                                                          | none                        | b
select, oninput, refusing: picked                                                                 | –                                                                | none                        | a
select, onchange: picked                                                                          | change b                                                         | none                        | b
select, onchange, refusing: picked                                                                | –                                                                | none                        | a
multiple, both: picked                                                                            | input a,b, change a,b                                            | none                        | a,b
multiple, both, refusing: picked                                                                  | –                                                                | none                        | a
multiple, oninput: picked                                                                         | input a,b                                                        | none                        | a,b
multiple, oninput, refusing: picked                                                               | –                                                                | none                        | a
multiple, onchange: picked                                                                        | change a,b                                                       | none                        | a,b
multiple, onchange, refusing: picked                                                              | –                                                                | none                        | a
text, both: a change alone                                                                        | input insertReplacementText filled, change filled                | insertReplacementText       | filled
text, both, refusing: a change alone                                                              | –                                                                | insertReplacementText       | a
text, oninput: a change alone                                                                     | input insertReplacementText filled                               | insertReplacementText       | filled
text, oninput, refusing: a change alone                                                           | –                                                                | insertReplacementText       | a
number, both: a change alone                                                                      | input insertReplacementText 12, change 12                        | insertReplacementText       | 12
number, both, refusing: a change alone                                                            | –                                                                | insertReplacementText       | 1
number, oninput: a change alone                                                                   | input insertReplacementText 12                                   | insertReplacementText       | 12
number, oninput, refusing: a change alone                                                         | –                                                                | insertReplacementText       | 1
textarea, both: a change alone                                                                    | input insertReplacementText filled, change filled                | insertReplacementText       | filled
textarea, both, refusing: a change alone                                                          | –                                                                | insertReplacementText       | a
textarea, oninput: a change alone                                                                 | input insertReplacementText filled                               | insertReplacementText       | filled
textarea, oninput, refusing: a change alone                                                       | –                                                                | insertReplacementText       | a
date, both: a change alone                                                                        | input insertReplacementText 2026-02-02, change 2026-02-02        | insertReplacementText       | 2026-02-02
date, both, refusing: a change alone                                                              | –                                                                | insertReplacementText       | 2026-01-01
date, oninput: a change alone                                                                     | input insertReplacementText 2026-02-02                           | insertReplacementText       | 2026-02-02
date, oninput, refusing: a change alone                                                           | –                                                                | insertReplacementText       | 2026-01-01
checkbox, both: a change alone                                                                    | input insertReplacementText on, change on                        | insertReplacementText       | on
checkbox, both, refusing: a change alone                                                          | –                                                                | insertReplacementText       | off
checkbox, oninput: a change alone                                                                 | input insertReplacementText on                                   | insertReplacementText       | on
checkbox, oninput, refusing: a change alone                                                       | –                                                                | insertReplacementText       | off
checkbox, onchange: a change alone                                                                | change on                                                        | insertReplacementText       | on
checkbox, onchange, refusing: a change alone                                                      | –                                                                | insertReplacementText       | off
radio, both: a change alone                                                                       | input insertReplacementText on, change on                        | insertReplacementText       | on
radio, both, refusing: a change alone                                                             | –                                                                | insertReplacementText       | off
radio, oninput: a change alone                                                                    | input insertReplacementText on                                   | insertReplacementText       | on
radio, oninput, refusing: a change alone                                                          | –                                                                | insertReplacementText       | off
radio, onchange: a change alone                                                                   | change on                                                        | insertReplacementText       | on
radio, onchange, refusing: a change alone                                                         | –                                                                | insertReplacementText       | off
select, both: a change alone                                                                      | input insertReplacementText b, change b                          | insertReplacementText       | b
select, both, refusing: a change alone                                                            | –                                                                | insertReplacementText       | a
select, oninput: a change alone                                                                   | input insertReplacementText b                                    | insertReplacementText       | b
select, oninput, refusing: a change alone                                                         | –                                                                | insertReplacementText       | a
select, onchange: a change alone                                                                  | change b                                                         | insertReplacementText       | b
select, onchange, refusing: a change alone                                                        | –                                                                | insertReplacementText       | a
multiple, both: a change alone                                                                    | input insertReplacementText a,b, change a,b                      | insertReplacementText       | a,b
multiple, both, refusing: a change alone                                                          | –                                                                | insertReplacementText       | a
multiple, oninput: a change alone                                                                 | input insertReplacementText a,b                                  | insertReplacementText       | a,b
multiple, oninput, refusing: a change alone                                                       | –                                                                | insertReplacementText       | a
multiple, onchange: a change alone                                                                | change a,b                                                       | insertReplacementText       | a,b
multiple, onchange, refusing: a change alone                                                      | –                                                                | insertReplacementText       | a
text, both: a word, Chromium                                                                      | input insertCompositionText a日本                                  | insertCompositionText       | a日本
text, both, refusing: a word, Chromium                                                            | –                                                                | insertCompositionText       | a
text, oninput: a word, Chromium                                                                   | input insertCompositionText a日本                                  | insertCompositionText       | a日本
text, oninput, refusing: a word, Chromium                                                         | –                                                                | insertCompositionText       | a
textarea, both: a word, Chromium                                                                  | input insertCompositionText a日本                                  | insertCompositionText       | a日本
textarea, both, refusing: a word, Chromium                                                        | –                                                                | insertCompositionText       | a
textarea, oninput: a word, Chromium                                                               | input insertCompositionText a日本                                  | insertCompositionText       | a日本
textarea, oninput, refusing: a word, Chromium                                                     | –                                                                | insertCompositionText       | a
text, both: a word, Firefox                                                                       | input insertCompositionText a日本                                  | insertCompositionText       | a日本
text, both, refusing: a word, Firefox                                                             | –                                                                | insertCompositionText       | a
text, oninput: a word, Firefox                                                                    | input insertCompositionText a日本                                  | insertCompositionText       | a日本
text, oninput, refusing: a word, Firefox                                                          | –                                                                | insertCompositionText       | a
textarea, both: a word, Firefox                                                                   | input insertCompositionText a日本                                  | insertCompositionText       | a日本
textarea, both, refusing: a word, Firefox                                                         | –                                                                | insertCompositionText       | a
textarea, oninput: a word, Firefox                                                                | input insertCompositionText a日本                                  | insertCompositionText       | a日本
textarea, oninput, refusing: a word, Firefox                                                      | –                                                                | insertCompositionText       | a
text, both: a word, then blurred                                                                  | input insertCompositionText a日本, change a日本                      | insertCompositionText       | a日本
text, both, refusing: a word, then blurred                                                        | –                                                                | insertCompositionText       | a
text, oninput: a word, then blurred                                                               | input insertCompositionText a日本                                  | insertCompositionText       | a日本
text, oninput, refusing: a word, then blurred                                                     | –                                                                | insertCompositionText       | a
textarea, both: a word, then blurred                                                              | input insertCompositionText a日本, change a日本                      | insertCompositionText       | a日本
textarea, both, refusing: a word, then blurred                                                    | –                                                                | insertCompositionText       | a
textarea, oninput: a word, then blurred                                                           | input insertCompositionText a日本                                  | insertCompositionText       | a日本
textarea, oninput, refusing: a word, then blurred                                                 | –                                                                | insertCompositionText       | a
text, both: a word lost to a blur, Firefox                                                        | input insertCompositionText a日本                                  | insertCompositionText       | a日本
text, both, refusing: a word lost to a blur, Firefox                                              | –                                                                | insertCompositionText       | a
text, oninput: a word lost to a blur, Firefox                                                     | input insertCompositionText a日本                                  | insertCompositionText       | a日本
text, oninput, refusing: a word lost to a blur, Firefox                                           | –                                                                | insertCompositionText       | a
textarea, both: a word lost to a blur, Firefox                                                    | input insertCompositionText a日本                                  | insertCompositionText       | a日本
textarea, both, refusing: a word lost to a blur, Firefox                                          | –                                                                | insertCompositionText       | a
textarea, oninput: a word lost to a blur, Firefox                                                 | input insertCompositionText a日本                                  | insertCompositionText       | a日本
textarea, oninput, refusing: a word lost to a blur, Firefox                                       | –                                                                | insertCompositionText       | a
text, both: typed, then blurred twice                                                             | input insertText ab, change ab                                   | insertText                  | ab
text, both, refusing: typed, then blurred twice                                                   | –                                                                | insertText                  | a
text, oninput: typed, then blurred twice                                                          | input insertText ab                                              | insertText                  | ab
text, oninput, refusing: typed, then blurred twice                                                | –                                                                | insertText                  | a
number, both: typed, then blurred twice                                                           | input insertText 12, change 12                                   | insertText                  | 12
number, both, refusing: typed, then blurred twice                                                 | –                                                                | insertText                  | 1
number, oninput: typed, then blurred twice                                                        | input insertText 12                                              | insertText                  | 12
number, oninput, refusing: typed, then blurred twice                                              | –                                                                | insertText                  | 1
textarea, both: typed, then blurred twice                                                         | input insertText ab, change ab                                   | insertText                  | ab
textarea, both, refusing: typed, then blurred twice                                               | –                                                                | insertText                  | a
textarea, oninput: typed, then blurred twice                                                      | input insertText ab                                              | insertText                  | ab
textarea, oninput, refusing: typed, then blurred twice                                            | –                                                                | insertText                  | a
checkbox, both: picked, then a change with nothing new                                            | input on, change on                                              | none                        | on
checkbox, both, refusing: picked, then a change with nothing new                                  | –                                                                | none                        | off
checkbox, oninput: picked, then a change with nothing new                                         | input on                                                         | none                        | on
checkbox, oninput, refusing: picked, then a change with nothing new                               | –                                                                | none                        | off
checkbox, onchange: picked, then a change with nothing new                                        | change on                                                        | none                        | on
checkbox, onchange, refusing: picked, then a change with nothing new                              | –                                                                | none                        | off
radio, both: picked, then a change with nothing new                                               | input on, change on                                              | none                        | on
radio, both, refusing: picked, then a change with nothing new                                     | –                                                                | none                        | off
radio, oninput: picked, then a change with nothing new                                            | input on                                                         | none                        | on
radio, oninput, refusing: picked, then a change with nothing new                                  | –                                                                | none                        | off
radio, onchange: picked, then a change with nothing new                                           | change on                                                        | none                        | on
radio, onchange, refusing: picked, then a change with nothing new                                 | –                                                                | none                        | off
select, both: picked, then a change with nothing new                                              | input b, change b                                                | none                        | b
select, both, refusing: picked, then a change with nothing new                                    | –                                                                | none                        | a
select, oninput: picked, then a change with nothing new                                           | input b                                                          | none                        | b
select, oninput, refusing: picked, then a change with nothing new                                 | –                                                                | none                        | a
select, onchange: picked, then a change with nothing new                                          | change b                                                         | none                        | b
select, onchange, refusing: picked, then a change with nothing new                                | –                                                                | none                        | a
multiple, both: picked, then a change with nothing new                                            | input a,b, change a,b                                            | none                        | a,b
multiple, both, refusing: picked, then a change with nothing new                                  | –                                                                | none                        | a
multiple, oninput: picked, then a change with nothing new                                         | input a,b                                                        | none                        | a,b
multiple, oninput, refusing: picked, then a change with nothing new                               | –                                                                | none                        | a
multiple, onchange: picked, then a change with nothing new                                        | change a,b                                                       | none                        | a,b
multiple, onchange, refusing: picked, then a change with nothing new                              | –                                                                | none                        | a
text, both: a change with nothing new                                                             | –                                                                | –                           | a
text, both, refusing: a change with nothing new                                                   | –                                                                | –                           | a
text, oninput: a change with nothing new                                                          | –                                                                | –                           | a
text, oninput, refusing: a change with nothing new                                                | –                                                                | –                           | a
number, both: a change with nothing new                                                           | –                                                                | –                           | 1
number, both, refusing: a change with nothing new                                                 | –                                                                | –                           | 1
number, oninput: a change with nothing new                                                        | –                                                                | –                           | 1
number, oninput, refusing: a change with nothing new                                              | –                                                                | –                           | 1
textarea, both: a change with nothing new                                                         | –                                                                | –                           | a
textarea, both, refusing: a change with nothing new                                               | –                                                                | –                           | a
textarea, oninput: a change with nothing new                                                      | –                                                                | –                           | a
textarea, oninput, refusing: a change with nothing new                                            | –                                                                | –                           | a
date, both: a change with nothing new                                                             | –                                                                | –                           | 2026-01-01
date, both, refusing: a change with nothing new                                                   | –                                                                | –                           | 2026-01-01
date, oninput: a change with nothing new                                                          | –                                                                | –                           | 2026-01-01
date, oninput, refusing: a change with nothing new                                                | –                                                                | –                           | 2026-01-01
checkbox, both: a change with nothing new                                                         | –                                                                | –                           | off
checkbox, both, refusing: a change with nothing new                                               | –                                                                | –                           | off
checkbox, oninput: a change with nothing new                                                      | –                                                                | –                           | off
checkbox, oninput, refusing: a change with nothing new                                            | –                                                                | –                           | off
checkbox, onchange: a change with nothing new                                                     | –                                                                | –                           | off
checkbox, onchange, refusing: a change with nothing new                                           | –                                                                | –                           | off
radio, both: a change with nothing new                                                            | –                                                                | –                           | off
radio, both, refusing: a change with nothing new                                                  | –                                                                | –                           | off
radio, oninput: a change with nothing new                                                         | –                                                                | –                           | off
radio, oninput, refusing: a change with nothing new                                               | –                                                                | –                           | off
radio, onchange: a change with nothing new                                                        | –                                                                | –                           | off
radio, onchange, refusing: a change with nothing new                                              | –                                                                | –                           | off
select, both: a change with nothing new                                                           | –                                                                | –                           | a
select, both, refusing: a change with nothing new                                                 | –                                                                | –                           | a
select, oninput: a change with nothing new                                                        | –                                                                | –                           | a
select, oninput, refusing: a change with nothing new                                              | –                                                                | –                           | a
select, onchange: a change with nothing new                                                       | –                                                                | –                           | a
select, onchange, refusing: a change with nothing new                                             | –                                                                | –                           | a
multiple, both: a change with nothing new                                                         | –                                                                | –                           | a
multiple, both, refusing: a change with nothing new                                               | –                                                                | –                           | a
multiple, oninput: a change with nothing new                                                      | –                                                                | –                           | a
multiple, oninput, refusing: a change with nothing new                                            | –                                                                | –                           | a
multiple, onchange: a change with nothing new                                                     | –                                                                | –                           | a
multiple, onchange, refusing: a change with nothing new                                           | –                                                                | –                           | a
checkbox, both: picked, then a change alone                                                       | input on, change on, input insertReplacementText off, change off | none, insertReplacementText | off
checkbox, both, refusing: picked, then a change alone                                             | –                                                                | none                        | off
checkbox, oninput: picked, then a change alone                                                    | input on, input insertReplacementText off                        | none, insertReplacementText | off
checkbox, oninput, refusing: picked, then a change alone                                          | –                                                                | none                        | off
checkbox, onchange: picked, then a change alone                                                   | change on, change off                                            | none, insertReplacementText | off
checkbox, onchange, refusing: picked, then a change alone                                         | –                                                                | none                        | off
select, both: picked, then a change alone                                                         | input b, change b, input insertReplacementText c, change c       | none, insertReplacementText | c
select, both, refusing: picked, then a change alone                                               | –                                                                | none, insertReplacementText | a
select, oninput: picked, then a change alone                                                      | input b, input insertReplacementText c                           | none, insertReplacementText | c
select, oninput, refusing: picked, then a change alone                                            | –                                                                | none, insertReplacementText | a
select, onchange: picked, then a change alone                                                     | change b, change c                                               | none, insertReplacementText | c
select, onchange, refusing: picked, then a change alone                                           | –                                                                | none, insertReplacementText | a
text, both: typed, blurred with no change, then a keystroke refused and a change                  | input insertText ab                                              | insertText, insertText      | ab
text, both, refusing: typed, blurred with no change, then a keystroke refused and a change        | –                                                                | insertText, insertText      | a
text, oninput: typed, blurred with no change, then a keystroke refused and a change               | input insertText ab                                              | insertText, insertText      | ab
text, oninput, refusing: typed, blurred with no change, then a keystroke refused and a change     | –                                                                | insertText, insertText      | a
textarea, both: typed, blurred with no change, then a keystroke refused and a change              | input insertText ab                                              | insertText, insertText      | ab
textarea, both, refusing: typed, blurred with no change, then a keystroke refused and a change    | –                                                                | insertText, insertText      | a
textarea, oninput: typed, blurred with no change, then a keystroke refused and a change           | input insertText ab                                              | insertText, insertText      | ab
textarea, oninput, refusing: typed, blurred with no change, then a keystroke refused and a change | –                                                                | insertText, insertText      | a
number, both: 1.0 over 1 as an input method's input, not composing                                | input insertCompositionText 1.0                                  | insertCompositionText       | 1.0
number, both, refusing: 1.0 over 1 as an input method's input, not composing                      | –                                                                | insertCompositionText       | 1
number, oninput: 1.0 over 1 as an input method's input, not composing                             | input insertCompositionText 1.0                                  | insertCompositionText       | 1.0
number, oninput, refusing: 1.0 over 1 as an input method's input, not composing                   | –                                                                | insertCompositionText       | 1
`;

const EXPECTED = new Map(
  TABLE.trim()
    .split("\n")
    .map((line) => {
      const [row, calls, decided, model] = line.split("|").map((cell) => cell.trim());
      const list = (cell: string) => (cell === "–" ? [] : cell.split(", "));
      return [row, { calls: list(calls), decided: list(decided), model }] as const;
    }),
);

describe("every event on every field", () => {
  test("the table names every row", () => {
    expect([...EXPECTED.keys()].sort()).toEqual(Object.keys(ROWS).sort());
  });

  for (const [name, row] of Object.entries(ROWS)) {
    test(name, async () => {
      const expected = EXPECTED.get(name);
      for (const inACommit of [false, true]) {
        const seen = await run(row, inACommit);
        expect({ inACommit, ...seen }).toEqual({ inACommit, ...expected, shown: expected?.model });
      }
    });
  }
});
