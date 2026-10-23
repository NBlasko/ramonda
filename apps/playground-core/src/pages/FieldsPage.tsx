import { Component, Select, TextArea, state, type EventOn } from "@ramonda/core";

const box = { margin: "0 0 1.5rem", padding: "0.75rem", border: "1px solid #ccc" };
const hint = { margin: "0 0 0.5rem", fontSize: "0.9em", color: "#555" };
const readout = { display: "block", margin: "0.5rem 0 0", fontFamily: "monospace" };

/**
 * A word typed through an input method, into a field the model holds.
 *
 * Two handlers, the two ways one is written: `skips` waits for the finished word, `takes` reads every
 * input. `takes` hears each step of the word as the browser sends it; `skips` is handed the finished
 * word once, at the composition's end, in every browser. Each readout lists what its handler took.
 * The same two are written on a `TextArea` and on an `<input>`, which reach the field by different
 * paths.
 */
class Composed extends Component<{ id: string; title: string; skipsComposing: boolean; field: "textarea" | "input" }> {
  @state text = "";
  @state taken: string[] = [];

  onInput(event: EventOn<HTMLTextAreaElement | HTMLInputElement, InputEvent>) {
    if (this.props.skipsComposing && event.isComposing) return;
    this.text = event.currentTarget.value;
    this.taken = [...this.taken, this.text];
  }

  render() {
    return (
      <section style={box}>
        <h3 style={{ margin: "0 0 0.25rem" }}>{this.props.title}</h3>
        <p style={hint}>
          Switch to a Japanese input method, type <code>nihon</code>, Space, Enter. The field keeps 日本, and the
          readout ends in 日本 — once.
        </p>
        {this.props.field === "textarea" ? (
          <TextArea id={this.props.id} aria-label={this.props.title} value={this.text} oninput={this.onInput} />
        ) : (
          <input id={this.props.id} aria-label={this.props.title} value={this.text} oninput={this.onInput} />
        )}
        <output id={`${this.props.id}-taken`} style={readout}>
          {JSON.stringify(this.taken)}
        </output>
      </section>
    );
  }
}

/**
 * A `defaultValue` select in a form: pick another size, press Reset, and it is back on `m`. The
 * default is written as the option's `selected` attribute, which is what a reset returns to.
 */
class Sized extends Component {
  render() {
    return (
      <section style={box}>
        <h3 style={{ margin: "0 0 0.25rem" }}>A form's reset</h3>
        <p style={hint}>Pick another size, then press Reset: the select goes back to m.</p>
        <form>
          <Select id="size" name="size" aria-label="Size" defaultValue="m">
            <option value="s">s</option>
            <option value="m">m</option>
            <option value="l">l</option>
          </Select>
          <button id="reset" type="reset" style={{ marginLeft: "0.4rem" }}>
            Reset
          </button>
        </form>
      </section>
    );
  }
}

/**
 * A browser drains microtasks between the listeners of one event, so a render can land in the
 * middle of it. Here each field writes its own model, and the form around them flips other state on
 * every `input` — a "Save" button coming on is the usual reason. The render that causes lands before
 * the select's `change`: the pick is the model's already, so it is not written back over.
 */
class Between extends Component {
  @state text = "";
  @state size = "m";
  @state touched = false;

  typed(event: EventOn<HTMLTextAreaElement>) {
    this.text = event.currentTarget.value;
  }

  picked(event: EventOn<HTMLSelectElement>) {
    this.size = event.currentTarget.value;
  }

  touch() {
    this.touched = true;
  }

  render() {
    return (
      <section style={box}>
        <h3 style={{ margin: "0 0 0.25rem" }}>3 — a render in the middle of an event</h3>
        <p style={hint}>Type into the field, and pick a size: both keep what you did.</p>
        <form oninput={this.touch}>
          <TextArea id="between-text" aria-label="Typed" value={this.text} oninput={this.typed} />
          <Select id="between-size" aria-label="Size" value={this.size} onchange={this.picked}>
            <option value="s">s</option>
            <option value="m">m</option>
            <option value="l">l</option>
          </Select>
          <button type="button" disabled={!this.touched}>
            Save
          </button>
        </form>
        <output id="between-model" style={readout}>
          {JSON.stringify({ text: this.text, size: this.size })}
        </output>
      </section>
    );
  }
}

/**
 * A pick or a keystroke the handler refuses is never drawn: the field answers the handler at once,
 * and a handler that writes nothing leaves the model where it was. `l` is not in stock, and the text
 * holds three characters at most. The form reads what the field keeps.
 */
class Refused extends Component {
  @state size = "m";
  @state text = "abc";
  @state read = "";

  picked(event: EventOn<HTMLSelectElement>) {
    if (event.currentTarget.value !== "l") this.size = event.currentTarget.value;
  }

  typed(event: EventOn<HTMLTextAreaElement>) {
    if (event.currentTarget.value.length <= 3) this.text = event.currentTarget.value;
  }

  heard(event: EventOn<HTMLFormElement>) {
    const target = event.target as HTMLSelectElement;
    if (target.id === "refused-size") this.read = target.value;
  }

  render() {
    return (
      <section style={box}>
        <h3 style={{ margin: "0 0 0.25rem" }}>4 — a refused pick is never drawn</h3>
        <p style={hint}>Pick l, or type a fourth character: neither shows, even for a frame.</p>
        <form onchange={this.heard}>
          <Select id="refused-size" aria-label="Size" value={this.size} onchange={this.picked}>
            <option value="s">s</option>
            <option value="m">m</option>
            <option value="l">l</option>
          </Select>
          <TextArea id="refused-text" aria-label="Three at most" value={this.text} oninput={this.typed} />
        </form>
        <output id="refused-read" style={readout}>
          {this.read}
        </output>
      </section>
    );
  }
}

/**
 * The same refusals on an `<input>`, whose own handlers core holds on the element: a keystroke the
 * handler refuses, a box the handler will not tick, and a radio the handler will not pick — the group
 * is put back whole, so `m` stays the one that is on.
 */
class RefusedInput extends Component {
  @state text = "abc";
  @state ticked = false;
  @state size = "m";

  /** Past three characters, the handler leaves the model where it was. */
  typed(event: EventOn<HTMLInputElement>) {
    if (event.currentTarget.value.length <= 3) this.text = event.currentTarget.value;
  }

  /** Never ticks: the terms are not ready to be accepted yet. */
  ticks(_event: EventOn<HTMLInputElement>) {
    this.ticked = false;
  }

  picks(event: EventOn<HTMLInputElement>) {
    if (event.currentTarget.value !== "l") this.size = event.currentTarget.value;
  }

  render() {
    return (
      <section style={box}>
        <h3 style={{ margin: "0 0 0.25rem" }}>5 — the same, on an input</h3>
        <p style={hint}>Type a fourth character, tick the box, pick l: none of them shows, even for a frame.</p>
        <input id="refused-input" aria-label="Three at most" value={this.text} oninput={this.typed} />
        <label>
          <input id="refused-box" type="checkbox" checked={this.ticked} oninput={this.ticks} /> Accept
        </label>
        <fieldset>
          <legend>Size</legend>
          <label>
            <input id="radio-m" type="radio" name="size" value="m" checked={this.size === "m"} oninput={this.picks} /> m
          </label>
          <label>
            <input id="radio-l" type="radio" name="size" value="l" checked={this.size === "l"} oninput={this.picks} /> l
          </label>
        </fieldset>
        <output id="refused-input-model" style={readout}>
          {JSON.stringify({ text: this.text, ticked: this.ticked, size: this.size })}
        </output>
      </section>
    );
  }
}

/** Fields whose behaviour only a browser settles — see `browser/fields.spec.ts`. */
export class FieldsPage extends Component {
  render() {
    return (
      <div>
        <h2>Fields in a browser</h2>
        <Composed id="skips" title="1 — a handler that skips composing input" skipsComposing={true} field="textarea" />
        <Composed id="takes" title="2 — a handler that takes every input" skipsComposing={false} field="textarea" />
        <Composed id="skips-input" title="1 — the same, on an input" skipsComposing={true} field="input" />
        <Composed id="takes-input" title="2 — the same, on an input" skipsComposing={false} field="input" />
        <Sized />
        <Between />
        <Refused />
        <RefusedInput />
      </div>
    );
  }
}
