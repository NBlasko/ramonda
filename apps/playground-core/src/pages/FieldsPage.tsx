import { Component, Select, TextArea, state } from "@ramonda/core";

const box = { margin: "0 0 1.5rem", padding: "0.75rem", border: "1px solid #ccc" };
const hint = { margin: "0 0 0.5rem", fontSize: "0.9em", color: "#555" };
const readout = { display: "block", margin: "0.5rem 0 0", fontFamily: "monospace" };

/**
 * A word typed through an input method, into a field the model holds.
 *
 * Two handlers, the two ways one is written. `skips` leaves on composing input, the usual way, and
 * takes the word from the ordinary `input` after the composition — which Firefox sends and Chromium
 * does not, so core sends it there. `takes` reads every input, composing or not, and has the word
 * already. Each readout lists what its handler took: the word must be there, and once.
 */
class Composed extends Component<{ id: string; title: string; skipsComposing: boolean }> {
  @state text = "";
  @state taken: string[] = [];

  onInput(event: InputEvent) {
    if (this.props.skipsComposing && event.isComposing) return;
    this.text = (event.target as HTMLTextAreaElement).value;
    this.taken = [...this.taken, this.text];
  }

  render() {
    return (
      <section style={box}>
        <h3 style={{ margin: "0 0 0.25rem" }}>{this.props.title}</h3>
        <p style={hint}>
          Switch to a Japanese input method, type <code>nihon</code>, Space, Enter. The field keeps 日本, and the last
          line below is 日本 — once.
        </p>
        <TextArea id={this.props.id} aria-label={this.props.title} value={this.text} oninput={this.onInput} />
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
 * middle of it. Here the field's own handler changes other state, and the form around it is what
 * moves the model: the render between them must not write the old text back before the form reads
 * the keystroke. The select does the same between a pick's `input` and its `change`.
 */
class Between extends Component {
  @state text = "";
  @state typed = 0;
  @state size = "m";
  @state touched = false;

  render() {
    return (
      <section style={box}>
        <h3 style={{ margin: "0 0 0.25rem" }}>3 — a render in the middle of an event</h3>
        <p style={hint}>Type into the field, and pick a size: both keep what you did.</p>
        <form
          oninput={(event: Event) => {
            const target = event.target as HTMLElement;
            if (target.id === "between-text") this.text = (target as HTMLTextAreaElement).value;
            else this.touched = true;
          }}
        >
          <TextArea id="between-text" aria-label="Typed" value={this.text} oninput={() => this.typed++} />
          <Select
            id="between-size"
            aria-label="Size"
            value={this.size}
            onchange={(event: Event) => (this.size = (event.target as HTMLSelectElement).value)}
          >
            <option value="s">s</option>
            <option value="m">m</option>
            <option value="l">l</option>
          </Select>
        </form>
        <output id="between-model" style={readout}>
          {JSON.stringify({ text: this.text, size: this.size })}
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
        <Composed id="skips" title="1 — a handler that skips composing input" skipsComposing={true} />
        <Composed id="takes" title="2 — a handler that takes every input" skipsComposing={false} />
        <Sized />
        <Between />
      </div>
    );
  }
}
