import { describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { mounted, state } from "../base/decorators";
import { Component, Select, TextArea, createRef, type EventOn } from "../index";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * What a controlled field does with each event a browser sends it, for every kind of field, written
 * as one table: which of the field's handlers is called, with what, and what the field shows after.
 * Every row is run twice — sent from the test, and sent from a `@mounted` while a commit is running,
 * where the field's settle waits for a microtask. Inside a commit, a second event finds the field
 * before the render of the first has written its model: the handler's decision is not known yet. That
 * is reported as RMD062, and the table says what the handlers were handed then; the model after is
 * the same either way.
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
  /** The handler refuses every edit: it writes nothing. */
  refuse?: boolean;
  /** The handler waits for a finished word: it hears nothing while `isComposing` says the word is not. */
  waits?: boolean;
  events: (field: AnyField) => void;
}

interface Seen {
  /** Each handler call: the event type the handler was handed, its `inputType`, and the field's value. */
  calls: string[];
  shown: string;
  model: string;
  /** RMD062 was reported: the field read its model while the render of its last edit was waiting. */
  reported: boolean;
}

async function run(row: Row, inACommit: boolean): Promise<Seen> {
  const { kind, handlers, refuse = false, waits = false, events } = row;
  resetDiagnostics();
  let reported = false;
  const heard = (event: Event) => {
    if ((event as CustomEvent<{ message: string }>).detail.message.startsWith("[RMD062]")) reported = true;
  };
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  window.addEventListener("ramonda:dev-log", heard);
  try {
    return await runIn(kind, handlers, { refuse, waits }, events, inACommit, () => reported);
  } finally {
    window.removeEventListener("ramonda:dev-log", heard);
    log.mockRestore();
  }
}

async function runIn(
  kind: Kind,
  handlers: Handlers,
  { refuse, waits }: { refuse: boolean; waits: boolean },
  events: (field: AnyField) => void,
  inACommit: boolean,
  reported: () => boolean,
): Promise<Seen> {
  class Field extends Component {
    @state model = START[kind];
    calls: string[] = [];
    field = createRef<AnyField>();
    /** Refuses every edit when the row says so, and always a text that ends in `!`. */
    edited(event: EventOn<AnyField>) {
      if (waits && (event as Event as InputEvent).isComposing) return;
      const inputType = (event as Event as InputEvent).inputType;
      this.calls.push(`${event.type}${inputType ? ` ${inputType}` : ""} ${read(event.currentTarget)}`);
      const next = modelOf(event.currentTarget);
      if (refuse || (typeof next === "string" && next.endsWith("!"))) return;
      this.model = next;
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
    shown: read(field),
    model: typeof model === "boolean" ? (model ? "on" : "off") : Array.isArray(model) ? model.join(",") : model,
    reported: reported(),
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
  "typed, blurred with no change (the window lost the focus), then a keystroke refused and a change": {
    kinds: ["text", "textarea"],
    events: (f) => {
      typeText(f, "ab");
      f.dispatchEvent(new FocusEvent("blur"));
      typeText(f, "ab!");
      change(f);
    },
  },
  "typed and put back, blurred, then a keystroke refused and a change": {
    kinds: ["text", "textarea"],
    events: (f) => {
      typeText(f, "ab");
      typeText(f, "a", "deleteContentBackward");
      f.dispatchEvent(new FocusEvent("blur"));
      typeText(f, "a!");
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
      // A word, to a handler that waits for it to be finished.
      if (scenario.startsWith("a word"))
        ROWS[`${kind}, ${handlers}, waiting: ${scenario}`] = { kind, handlers, waits: true, events };
    }
  }
}

/**
 * Row | the handler calls, in order: the event type each was handed, its `inputType`, the field's value |
 * the model after, which the field shows — or `shows` what it shows instead, a number written another
 * way | inside a commit: `same` calls, with RMD062 or without, or `RMD062:` and the calls handed then.
 */
const TABLE = `
text, both: typed                                                                                                             | input insertText ab                                                                              | ab          | same
text, both, refusing: typed                                                                                                   | input insertText ab                                                                              | a           | same
text, oninput: typed                                                                                                          | input insertText ab                                                                              | ab          | same
text, oninput, refusing: typed                                                                                                | input insertText ab                                                                              | a           | same
number, both: typed                                                                                                           | input insertText 12                                                                              | 12          | same
number, both, refusing: typed                                                                                                 | input insertText 12                                                                              | 1           | same
number, oninput: typed                                                                                                        | input insertText 12                                                                              | 12          | same
number, oninput, refusing: typed                                                                                              | input insertText 12                                                                              | 1           | same
textarea, both: typed                                                                                                         | input insertText ab                                                                              | ab          | same
textarea, both, refusing: typed                                                                                               | input insertText ab                                                                              | a           | same
textarea, oninput: typed                                                                                                      | input insertText ab                                                                              | ab          | same
textarea, oninput, refusing: typed                                                                                            | input insertText ab                                                                              | a           | same
text, both: typed, then blurred                                                                                               | input insertText ab, change ab                                                                   | ab          | same, RMD062
text, both, refusing: typed, then blurred                                                                                     | input insertText ab                                                                              | a           | RMD062: input insertText ab, change ab
text, oninput: typed, then blurred                                                                                            | input insertText ab                                                                              | ab          | same, RMD062
text, oninput, refusing: typed, then blurred                                                                                  | input insertText ab                                                                              | a           | same, RMD062
number, both: typed, then blurred                                                                                             | input insertText 12, change 12                                                                   | 12          | same, RMD062
number, both, refusing: typed, then blurred                                                                                   | input insertText 12                                                                              | 1           | RMD062: input insertText 12, change 12
number, oninput: typed, then blurred                                                                                          | input insertText 12                                                                              | 12          | same, RMD062
number, oninput, refusing: typed, then blurred                                                                                | input insertText 12                                                                              | 1           | same, RMD062
textarea, both: typed, then blurred                                                                                           | input insertText ab, change ab                                                                   | ab          | same, RMD062
textarea, both, refusing: typed, then blurred                                                                                 | input insertText ab                                                                              | a           | RMD062: input insertText ab, change ab
textarea, oninput: typed, then blurred                                                                                        | input insertText ab                                                                              | ab          | same, RMD062
textarea, oninput, refusing: typed, then blurred                                                                              | input insertText ab                                                                              | a           | same, RMD062
text, both: typed, then a keystroke refused, then blurred                                                                     | input insertText ab, input insertText ab!, change ab                                             | ab          | RMD062: input insertText ab, input insertText ab!, change ab!
text, both, refusing: typed, then a keystroke refused, then blurred                                                           | input insertText ab, input insertText ab!                                                        | a           | RMD062: input insertText ab, input insertText ab!, change ab!
text, oninput: typed, then a keystroke refused, then blurred                                                                  | input insertText ab, input insertText ab!                                                        | ab          | same, RMD062
text, oninput, refusing: typed, then a keystroke refused, then blurred                                                        | input insertText ab, input insertText ab!                                                        | a           | same, RMD062
textarea, both: typed, then a keystroke refused, then blurred                                                                 | input insertText ab, input insertText ab!, change ab                                             | ab          | RMD062: input insertText ab, input insertText ab!, change ab!
textarea, both, refusing: typed, then a keystroke refused, then blurred                                                       | input insertText ab, input insertText ab!                                                        | a           | RMD062: input insertText ab, input insertText ab!, change ab!
textarea, oninput: typed, then a keystroke refused, then blurred                                                              | input insertText ab, input insertText ab!                                                        | ab          | same, RMD062
textarea, oninput, refusing: typed, then a keystroke refused, then blurred                                                    | input insertText ab, input insertText ab!                                                        | a           | same, RMD062
text, both: typed, then blurred twice                                                                                         | input insertText ab, change ab                                                                   | ab          | same, RMD062
text, both, refusing: typed, then blurred twice                                                                               | input insertText ab                                                                              | a           | RMD062: input insertText ab, change ab
text, oninput: typed, then blurred twice                                                                                      | input insertText ab                                                                              | ab          | same, RMD062
text, oninput, refusing: typed, then blurred twice                                                                            | input insertText ab                                                                              | a           | same, RMD062
number, both: typed, then blurred twice                                                                                       | input insertText 12, change 12                                                                   | 12          | same, RMD062
number, both, refusing: typed, then blurred twice                                                                             | input insertText 12                                                                              | 1           | RMD062: input insertText 12, change 12
number, oninput: typed, then blurred twice                                                                                    | input insertText 12                                                                              | 12          | same, RMD062
number, oninput, refusing: typed, then blurred twice                                                                          | input insertText 12                                                                              | 1           | same, RMD062
textarea, both: typed, then blurred twice                                                                                     | input insertText ab, change ab                                                                   | ab          | same, RMD062
textarea, both, refusing: typed, then blurred twice                                                                           | input insertText ab                                                                              | a           | RMD062: input insertText ab, change ab
textarea, oninput: typed, then blurred twice                                                                                  | input insertText ab                                                                              | ab          | same, RMD062
textarea, oninput, refusing: typed, then blurred twice                                                                        | input insertText ab                                                                              | a           | same, RMD062
checkbox, both: picked, then a change with nothing new                                                                        | input on, change on                                                                              | on          | same, RMD062
checkbox, both, refusing: picked, then a change with nothing new                                                              | input on, change on                                                                              | off         | same, RMD062
checkbox, oninput: picked, then a change with nothing new                                                                     | input on                                                                                         | on          | same, RMD062
checkbox, oninput, refusing: picked, then a change with nothing new                                                           | input on                                                                                         | off         | same, RMD062
checkbox, onchange: picked, then a change with nothing new                                                                    | change on                                                                                        | on          | same, RMD062
checkbox, onchange, refusing: picked, then a change with nothing new                                                          | change on                                                                                        | off         | same, RMD062
radio, both: picked, then a change with nothing new                                                                           | input on, change on                                                                              | on          | same, RMD062
radio, both, refusing: picked, then a change with nothing new                                                                 | input on, change on                                                                              | off         | same, RMD062
radio, oninput: picked, then a change with nothing new                                                                        | input on                                                                                         | on          | same, RMD062
radio, oninput, refusing: picked, then a change with nothing new                                                              | input on                                                                                         | off         | same, RMD062
radio, onchange: picked, then a change with nothing new                                                                       | change on                                                                                        | on          | same, RMD062
radio, onchange, refusing: picked, then a change with nothing new                                                             | change on                                                                                        | off         | same, RMD062
select, both: picked, then a change with nothing new                                                                          | input b, change b                                                                                | b           | same, RMD062
select, both, refusing: picked, then a change with nothing new                                                                | input b, change b                                                                                | a           | same, RMD062
select, oninput: picked, then a change with nothing new                                                                       | input b                                                                                          | b           | same, RMD062
select, oninput, refusing: picked, then a change with nothing new                                                             | input b                                                                                          | a           | same, RMD062
select, onchange: picked, then a change with nothing new                                                                      | change b                                                                                         | b           | same, RMD062
select, onchange, refusing: picked, then a change with nothing new                                                            | change b                                                                                         | a           | same, RMD062
multiple, both: picked, then a change with nothing new                                                                        | input a,b, change a,b                                                                            | a,b         | same, RMD062
multiple, both, refusing: picked, then a change with nothing new                                                              | input a,b, change a,b                                                                            | a           | same, RMD062
multiple, oninput: picked, then a change with nothing new                                                                     | input a,b                                                                                        | a,b         | same, RMD062
multiple, oninput, refusing: picked, then a change with nothing new                                                           | input a,b                                                                                        | a           | same, RMD062
multiple, onchange: picked, then a change with nothing new                                                                    | change a,b                                                                                       | a,b         | same, RMD062
multiple, onchange, refusing: picked, then a change with nothing new                                                          | change a,b                                                                                       | a           | same, RMD062
checkbox, both: picked, then a change alone                                                                                   | input on, change on, input insertReplacementText off, change off                                 | off         | same, RMD062
checkbox, both, refusing: picked, then a change alone                                                                         | input on, change on                                                                              | off         | RMD062: input on, change on, input insertReplacementText off, change off
checkbox, oninput: picked, then a change alone                                                                                | input on, input insertReplacementText off                                                        | off         | same, RMD062
checkbox, oninput, refusing: picked, then a change alone                                                                      | input on                                                                                         | off         | RMD062: input on, input insertReplacementText off
checkbox, onchange: picked, then a change alone                                                                               | change on, change off                                                                            | off         | same, RMD062
checkbox, onchange, refusing: picked, then a change alone                                                                     | change on                                                                                        | off         | RMD062: change on, change off
select, both: picked, then a change alone                                                                                     | input b, change b, input insertReplacementText c, change c                                       | c           | same, RMD062
select, both, refusing: picked, then a change alone                                                                           | input b, change b, input insertReplacementText c, change c                                       | a           | same, RMD062
select, oninput: picked, then a change alone                                                                                  | input b, input insertReplacementText c                                                           | c           | same, RMD062
select, oninput, refusing: picked, then a change alone                                                                        | input b, input insertReplacementText c                                                           | a           | same, RMD062
select, onchange: picked, then a change alone                                                                                 | change b, change c                                                                               | c           | same, RMD062
select, onchange, refusing: picked, then a change alone                                                                       | change b, change c                                                                               | a           | same, RMD062
text, both: a change with nothing new                                                                                         | –                                                                                                | a           | same
text, both, refusing: a change with nothing new                                                                               | –                                                                                                | a           | same
text, oninput: a change with nothing new                                                                                      | –                                                                                                | a           | same
text, oninput, refusing: a change with nothing new                                                                            | –                                                                                                | a           | same
number, both: a change with nothing new                                                                                       | –                                                                                                | 1           | same
number, both, refusing: a change with nothing new                                                                             | –                                                                                                | 1           | same
number, oninput: a change with nothing new                                                                                    | –                                                                                                | 1           | same
number, oninput, refusing: a change with nothing new                                                                          | –                                                                                                | 1           | same
textarea, both: a change with nothing new                                                                                     | –                                                                                                | a           | same
textarea, both, refusing: a change with nothing new                                                                           | –                                                                                                | a           | same
textarea, oninput: a change with nothing new                                                                                  | –                                                                                                | a           | same
textarea, oninput, refusing: a change with nothing new                                                                        | –                                                                                                | a           | same
date, both: a change with nothing new                                                                                         | –                                                                                                | 2026-01-01  | same
date, both, refusing: a change with nothing new                                                                               | –                                                                                                | 2026-01-01  | same
date, oninput: a change with nothing new                                                                                      | –                                                                                                | 2026-01-01  | same
date, oninput, refusing: a change with nothing new                                                                            | –                                                                                                | 2026-01-01  | same
checkbox, both: a change with nothing new                                                                                     | –                                                                                                | off         | same
checkbox, both, refusing: a change with nothing new                                                                           | –                                                                                                | off         | same
checkbox, oninput: a change with nothing new                                                                                  | –                                                                                                | off         | same
checkbox, oninput, refusing: a change with nothing new                                                                        | –                                                                                                | off         | same
checkbox, onchange: a change with nothing new                                                                                 | –                                                                                                | off         | same
checkbox, onchange, refusing: a change with nothing new                                                                       | –                                                                                                | off         | same
radio, both: a change with nothing new                                                                                        | –                                                                                                | off         | same
radio, both, refusing: a change with nothing new                                                                              | –                                                                                                | off         | same
radio, oninput: a change with nothing new                                                                                     | –                                                                                                | off         | same
radio, oninput, refusing: a change with nothing new                                                                           | –                                                                                                | off         | same
radio, onchange: a change with nothing new                                                                                    | –                                                                                                | off         | same
radio, onchange, refusing: a change with nothing new                                                                          | –                                                                                                | off         | same
select, both: a change with nothing new                                                                                       | –                                                                                                | a           | same
select, both, refusing: a change with nothing new                                                                             | –                                                                                                | a           | same
select, oninput: a change with nothing new                                                                                    | –                                                                                                | a           | same
select, oninput, refusing: a change with nothing new                                                                          | –                                                                                                | a           | same
select, onchange: a change with nothing new                                                                                   | –                                                                                                | a           | same
select, onchange, refusing: a change with nothing new                                                                         | –                                                                                                | a           | same
multiple, both: a change with nothing new                                                                                     | –                                                                                                | a           | same
multiple, both, refusing: a change with nothing new                                                                           | –                                                                                                | a           | same
multiple, oninput: a change with nothing new                                                                                  | –                                                                                                | a           | same
multiple, oninput, refusing: a change with nothing new                                                                        | –                                                                                                | a           | same
multiple, onchange: a change with nothing new                                                                                 | –                                                                                                | a           | same
multiple, onchange, refusing: a change with nothing new                                                                       | –                                                                                                | a           | same
text, both: typed, blurred with no change (the window lost the focus), then a keystroke refused and a change                  | input insertText ab, input insertText ab!, change ab                                             | ab          | RMD062: input insertText ab, input insertText ab!, change ab!
text, both, refusing: typed, blurred with no change (the window lost the focus), then a keystroke refused and a change        | input insertText ab, input insertText ab!                                                        | a           | RMD062: input insertText ab, input insertText ab!, change ab!
text, oninput: typed, blurred with no change (the window lost the focus), then a keystroke refused and a change               | input insertText ab, input insertText ab!                                                        | ab          | same, RMD062
text, oninput, refusing: typed, blurred with no change (the window lost the focus), then a keystroke refused and a change     | input insertText ab, input insertText ab!                                                        | a           | same, RMD062
textarea, both: typed, blurred with no change (the window lost the focus), then a keystroke refused and a change              | input insertText ab, input insertText ab!, change ab                                             | ab          | RMD062: input insertText ab, input insertText ab!, change ab!
textarea, both, refusing: typed, blurred with no change (the window lost the focus), then a keystroke refused and a change    | input insertText ab, input insertText ab!                                                        | a           | RMD062: input insertText ab, input insertText ab!, change ab!
textarea, oninput: typed, blurred with no change (the window lost the focus), then a keystroke refused and a change           | input insertText ab, input insertText ab!                                                        | ab          | same, RMD062
textarea, oninput, refusing: typed, blurred with no change (the window lost the focus), then a keystroke refused and a change | input insertText ab, input insertText ab!                                                        | a           | same, RMD062
text, both: typed and put back, blurred, then a keystroke refused and a change                                                | input insertText ab, input deleteContentBackward a, input insertText a!                          | a           | RMD062: input insertText ab, input deleteContentBackward a, input insertText a!, change a!
text, both, refusing: typed and put back, blurred, then a keystroke refused and a change                                      | input insertText ab, input deleteContentBackward a, input insertText a!                          | a           | RMD062: input insertText ab, input deleteContentBackward a, input insertText a!, change a!
text, oninput: typed and put back, blurred, then a keystroke refused and a change                                             | input insertText ab, input deleteContentBackward a, input insertText a!                          | a           | same, RMD062
text, oninput, refusing: typed and put back, blurred, then a keystroke refused and a change                                   | input insertText ab, input deleteContentBackward a, input insertText a!                          | a           | same, RMD062
textarea, both: typed and put back, blurred, then a keystroke refused and a change                                            | input insertText ab, input deleteContentBackward a, input insertText a!                          | a           | RMD062: input insertText ab, input deleteContentBackward a, input insertText a!, change a!
textarea, both, refusing: typed and put back, blurred, then a keystroke refused and a change                                  | input insertText ab, input deleteContentBackward a, input insertText a!                          | a           | RMD062: input insertText ab, input deleteContentBackward a, input insertText a!, change a!
textarea, oninput: typed and put back, blurred, then a keystroke refused and a change                                         | input insertText ab, input deleteContentBackward a, input insertText a!                          | a           | same, RMD062
textarea, oninput, refusing: typed and put back, blurred, then a keystroke refused and a change                               | input insertText ab, input deleteContentBackward a, input insertText a!                          | a           | same, RMD062
number, both: 1.0 over 1 as an input method's input, not composing                                                            | input insertCompositionText 1.0                                                                  | 1.0         | same
number, both, refusing: 1.0 over 1 as an input method's input, not composing                                                  | input insertCompositionText 1.0                                                                  | 1           | same
number, oninput: 1.0 over 1 as an input method's input, not composing                                                         | input insertCompositionText 1.0                                                                  | 1.0         | same
number, oninput, refusing: 1.0 over 1 as an input method's input, not composing                                               | input insertCompositionText 1.0                                                                  | 1           | same
text, both: the same text pasted                                                                                              | input insertFromPaste a                                                                          | a           | same
text, both, refusing: the same text pasted                                                                                    | input insertFromPaste a                                                                          | a           | same
text, oninput: the same text pasted                                                                                           | input insertFromPaste a                                                                          | a           | same
text, oninput, refusing: the same text pasted                                                                                 | input insertFromPaste a                                                                          | a           | same
textarea, both: the same text pasted                                                                                          | input insertFromPaste a                                                                          | a           | same
textarea, both, refusing: the same text pasted                                                                                | input insertFromPaste a                                                                          | a           | same
textarea, oninput: the same text pasted                                                                                       | input insertFromPaste a                                                                          | a           | same
textarea, oninput, refusing: the same text pasted                                                                             | input insertFromPaste a                                                                          | a           | same
number, both: 1.0 typed over 1                                                                                                | input insertText 1.0                                                                             | 1.0         | same
number, both, refusing: 1.0 typed over 1                                                                                      | input insertText 1.0                                                                             | 1           | same
number, oninput: 1.0 typed over 1                                                                                             | input insertText 1.0                                                                             | 1.0         | same
number, oninput, refusing: 1.0 typed over 1                                                                                   | input insertText 1.0                                                                             | 1           | same
date, both: picked                                                                                                            | input 2026-02-02, change 2026-02-02                                                              | 2026-02-02  | same, RMD062
date, both, refusing: picked                                                                                                  | input 2026-02-02                                                                                 | 2026-01-01  | RMD062: input 2026-02-02, change 2026-02-02
date, oninput: picked                                                                                                         | input 2026-02-02                                                                                 | 2026-02-02  | same, RMD062
date, oninput, refusing: picked                                                                                               | input 2026-02-02                                                                                 | 2026-01-01  | same, RMD062
checkbox, both: picked                                                                                                        | input on, change on                                                                              | on          | same
checkbox, both, refusing: picked                                                                                              | input on, change on                                                                              | off         | same
checkbox, oninput: picked                                                                                                     | input on                                                                                         | on          | same
checkbox, oninput, refusing: picked                                                                                           | input on                                                                                         | off         | same
checkbox, onchange: picked                                                                                                    | change on                                                                                        | on          | same
checkbox, onchange, refusing: picked                                                                                          | change on                                                                                        | off         | same
radio, both: picked                                                                                                           | input on, change on                                                                              | on          | same
radio, both, refusing: picked                                                                                                 | input on, change on                                                                              | off         | same
radio, oninput: picked                                                                                                        | input on                                                                                         | on          | same
radio, oninput, refusing: picked                                                                                              | input on                                                                                         | off         | same
radio, onchange: picked                                                                                                       | change on                                                                                        | on          | same
radio, onchange, refusing: picked                                                                                             | change on                                                                                        | off         | same
select, both: picked                                                                                                          | input b, change b                                                                                | b           | same
select, both, refusing: picked                                                                                                | input b, change b                                                                                | a           | same
select, oninput: picked                                                                                                       | input b                                                                                          | b           | same
select, oninput, refusing: picked                                                                                             | input b                                                                                          | a           | same
select, onchange: picked                                                                                                      | change b                                                                                         | b           | same
select, onchange, refusing: picked                                                                                            | change b                                                                                         | a           | same
multiple, both: picked                                                                                                        | input a,b, change a,b                                                                            | a,b         | same
multiple, both, refusing: picked                                                                                              | input a,b, change a,b                                                                            | a           | same
multiple, oninput: picked                                                                                                     | input a,b                                                                                        | a,b         | same
multiple, oninput, refusing: picked                                                                                           | input a,b                                                                                        | a           | same
multiple, onchange: picked                                                                                                    | change a,b                                                                                       | a,b         | same
multiple, onchange, refusing: picked                                                                                          | change a,b                                                                                       | a           | same
text, both: a change alone                                                                                                    | input insertReplacementText filled, change filled                                                | filled      | same
text, both, refusing: a change alone                                                                                          | input insertReplacementText filled, change filled                                                | a           | same
text, oninput: a change alone                                                                                                 | input insertReplacementText filled                                                               | filled      | same
text, oninput, refusing: a change alone                                                                                       | input insertReplacementText filled                                                               | a           | same
number, both: a change alone                                                                                                  | input insertReplacementText 12, change 12                                                        | 12          | same
number, both, refusing: a change alone                                                                                        | input insertReplacementText 12, change 12                                                        | 1           | same
number, oninput: a change alone                                                                                               | input insertReplacementText 12                                                                   | 12          | same
number, oninput, refusing: a change alone                                                                                     | input insertReplacementText 12                                                                   | 1           | same
textarea, both: a change alone                                                                                                | input insertReplacementText filled, change filled                                                | filled      | same
textarea, both, refusing: a change alone                                                                                      | input insertReplacementText filled, change filled                                                | a           | same
textarea, oninput: a change alone                                                                                             | input insertReplacementText filled                                                               | filled      | same
textarea, oninput, refusing: a change alone                                                                                   | input insertReplacementText filled                                                               | a           | same
date, both: a change alone                                                                                                    | input insertReplacementText 2026-02-02, change 2026-02-02                                        | 2026-02-02  | same
date, both, refusing: a change alone                                                                                          | input insertReplacementText 2026-02-02, change 2026-02-02                                        | 2026-01-01  | same
date, oninput: a change alone                                                                                                 | input insertReplacementText 2026-02-02                                                           | 2026-02-02  | same
date, oninput, refusing: a change alone                                                                                       | input insertReplacementText 2026-02-02                                                           | 2026-01-01  | same
checkbox, both: a change alone                                                                                                | input insertReplacementText on, change on                                                        | on          | same
checkbox, both, refusing: a change alone                                                                                      | input insertReplacementText on, change on                                                        | off         | same
checkbox, oninput: a change alone                                                                                             | input insertReplacementText on                                                                   | on          | same
checkbox, oninput, refusing: a change alone                                                                                   | input insertReplacementText on                                                                   | off         | same
checkbox, onchange: a change alone                                                                                            | change on                                                                                        | on          | same
checkbox, onchange, refusing: a change alone                                                                                  | change on                                                                                        | off         | same
radio, both: a change alone                                                                                                   | input insertReplacementText on, change on                                                        | on          | same
radio, both, refusing: a change alone                                                                                         | input insertReplacementText on, change on                                                        | off         | same
radio, oninput: a change alone                                                                                                | input insertReplacementText on                                                                   | on          | same
radio, oninput, refusing: a change alone                                                                                      | input insertReplacementText on                                                                   | off         | same
radio, onchange: a change alone                                                                                               | change on                                                                                        | on          | same
radio, onchange, refusing: a change alone                                                                                     | change on                                                                                        | off         | same
select, both: a change alone                                                                                                  | input insertReplacementText b, change b                                                          | b           | same
select, both, refusing: a change alone                                                                                        | input insertReplacementText b, change b                                                          | a           | same
select, oninput: a change alone                                                                                               | input insertReplacementText b                                                                    | b           | same
select, oninput, refusing: a change alone                                                                                     | input insertReplacementText b                                                                    | a           | same
select, onchange: a change alone                                                                                              | change b                                                                                         | b           | same
select, onchange, refusing: a change alone                                                                                    | change b                                                                                         | a           | same
multiple, both: a change alone                                                                                                | input insertReplacementText a,b, change a,b                                                      | a,b         | same
multiple, both, refusing: a change alone                                                                                      | input insertReplacementText a,b, change a,b                                                      | a           | same
multiple, oninput: a change alone                                                                                             | input insertReplacementText a,b                                                                  | a,b         | same
multiple, oninput, refusing: a change alone                                                                                   | input insertReplacementText a,b                                                                  | a           | same
multiple, onchange: a change alone                                                                                            | change a,b                                                                                       | a,b         | same
multiple, onchange, refusing: a change alone                                                                                  | change a,b                                                                                       | a           | same
text, both: a word, Chromium                                                                                                  | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
text, both, refusing: a word, Chromium                                                                                        | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
text, both, waiting: a word, Chromium                                                                                         | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
text, oninput: a word, Chromium                                                                                               | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
text, oninput, refusing: a word, Chromium                                                                                     | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
text, oninput, waiting: a word, Chromium                                                                                      | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
textarea, both: a word, Chromium                                                                                              | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
textarea, both, refusing: a word, Chromium                                                                                    | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
textarea, both, waiting: a word, Chromium                                                                                     | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
textarea, oninput: a word, Chromium                                                                                           | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
textarea, oninput, refusing: a word, Chromium                                                                                 | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
textarea, oninput, waiting: a word, Chromium                                                                                  | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
text, both: a word, Firefox                                                                                                   | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
text, both, refusing: a word, Firefox                                                                                         | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
text, both, waiting: a word, Firefox                                                                                          | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
text, oninput: a word, Firefox                                                                                                | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
text, oninput, refusing: a word, Firefox                                                                                      | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
text, oninput, waiting: a word, Firefox                                                                                       | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
textarea, both: a word, Firefox                                                                                               | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
textarea, both, refusing: a word, Firefox                                                                                     | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
textarea, both, waiting: a word, Firefox                                                                                      | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
textarea, oninput: a word, Firefox                                                                                            | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
textarea, oninput, refusing: a word, Firefox                                                                                  | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
textarea, oninput, waiting: a word, Firefox                                                                                   | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
text, both: a word, then blurred                                                                                              | input insertCompositionText a日, input insertCompositionText a日本, change a日本                      | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本, change a日本
text, both, refusing: a word, then blurred                                                                                    | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本, change a日本
text, both, waiting: a word, then blurred                                                                                     | input insertCompositionText a日本, change a日本                                                      | a日本         | same, RMD062
text, oninput: a word, then blurred                                                                                           | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
text, oninput, refusing: a word, then blurred                                                                                 | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
text, oninput, waiting: a word, then blurred                                                                                  | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
textarea, both: a word, then blurred                                                                                          | input insertCompositionText a日, input insertCompositionText a日本, change a日本                      | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本, change a日本
textarea, both, refusing: a word, then blurred                                                                                | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本, change a日本
textarea, both, waiting: a word, then blurred                                                                                 | input insertCompositionText a日本, change a日本                                                      | a日本         | same, RMD062
textarea, oninput: a word, then blurred                                                                                       | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
textarea, oninput, refusing: a word, then blurred                                                                             | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
textarea, oninput, waiting: a word, then blurred                                                                              | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
text, both: a word lost to a blur, Firefox                                                                                    | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
text, both, refusing: a word lost to a blur, Firefox                                                                          | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
text, both, waiting: a word lost to a blur, Firefox                                                                           | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
text, oninput: a word lost to a blur, Firefox                                                                                 | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
text, oninput, refusing: a word lost to a blur, Firefox                                                                       | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
text, oninput, waiting: a word lost to a blur, Firefox                                                                        | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
textarea, both: a word lost to a blur, Firefox                                                                                | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
textarea, both, refusing: a word lost to a blur, Firefox                                                                      | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
textarea, both, waiting: a word lost to a blur, Firefox                                                                       | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
textarea, oninput: a word lost to a blur, Firefox                                                                             | input insertCompositionText a日, input insertCompositionText a日本                                  | a日本         | RMD062: input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本
textarea, oninput, refusing: a word lost to a blur, Firefox                                                                   | input insertCompositionText a日, input insertCompositionText a日本, input insertCompositionText a日本 | a           | same, RMD062
textarea, oninput, waiting: a word lost to a blur, Firefox                                                                    | input insertCompositionText a日本                                                                  | a日本         | same, RMD062
`;

const EXPECTED = new Map(
  TABLE.trim()
    .split("\n")
    .map((line) => {
      const [row, calls, after, inside] = line.split("|").map((cell) => cell.trim());
      const list = (cell: string) => (cell === "–" ? [] : cell.split(", "));
      const [model, shown = model] = after.split(" shows ");
      const outside = { calls: list(calls), shown, model, reported: false };
      const insideCalls = inside.startsWith("RMD062: ") ? list(inside.slice("RMD062: ".length)) : outside.calls;
      const reported = inside !== "same";
      return [row, { outside, inside: { ...outside, calls: insideCalls, reported } }] as const;
    }),
);

describe("every event on every field", () => {
  test("the table names every row", () => {
    expect([...EXPECTED.keys()].sort()).toEqual(Object.keys(ROWS).sort());
  });

  for (const [name, row] of Object.entries(ROWS)) {
    test(name, async () => {
      const expected = EXPECTED.get(name);
      expect({ inACommit: false, ...(await run(row, false)) }).toEqual({ inACommit: false, ...expected?.outside });
      expect({ inACommit: true, ...(await run(row, true)) }).toEqual({ inACommit: true, ...expected?.inside });
    });
  }
});
