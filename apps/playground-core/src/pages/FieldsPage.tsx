import { Component, Select, TextArea, state, type EventOn } from "@ramonda/core";

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
 * A pick or a keystroke that is refused is never drawn, refused either way: by the field's
 * `transform`, before any handler, or by the handler itself, which the field answers at once. `l` is
 * not in stock, and the text holds three characters at most. The form reads what the field keeps.
 */
class Refused extends Component {
  @state size = "m";
  @state text = "abc";
  @state handled = "m";
  @state read = "";

  inStock(next: string, prev: string): string {
    return next === "l" ? prev : next;
  }

  max3(next: string, prev: string): string {
    return next.length <= 3 ? next : prev;
  }

  picked(event: EventOn<HTMLSelectElement>) {
    this.size = event.currentTarget.value;
  }

  typed(event: EventOn<HTMLTextAreaElement>) {
    this.text = event.currentTarget.value;
  }

  /** The handler refuses on its own: it leaves the model where it was. */
  pickedByHand(event: EventOn<HTMLSelectElement>) {
    const wanted = event.currentTarget.value;
    if (wanted !== "l") this.handled = wanted;
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
          <Select id="refused-size" aria-label="Size" value={this.size} onchange={this.picked} transform={this.inStock}>
            <option value="s">s</option>
            <option value="m">m</option>
            <option value="l">l</option>
          </Select>
          <TextArea
            id="refused-text"
            aria-label="Three at most"
            value={this.text}
            oninput={this.typed}
            transform={this.max3}
          />
          <Select
            id="refused-by-hand"
            aria-label="Size, refused by the handler"
            value={this.handled}
            onchange={this.pickedByHand}
          >
            <option value="s">s</option>
            <option value="m">m</option>
            <option value="l">l</option>
          </Select>
        </form>
        <output id="refused-read" style={readout}>
          {this.read}
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
        <Refused />
      </div>
    );
  }
}
