import { Component, state } from "@ramonda/core";

/**
 * The caret in a controlled field, for the eye rather than for a test.
 *
 * Assigning `.value` drops the caret to the end of the field. jsdom implements `selectionStart`, so
 * the fix is covered by tests — but whether a real browser resets the caret in exactly the same
 * places is not something jsdom can answer. This page is where that is checked.
 *
 * **What to do, per field: click in the MIDDLE of the text, type a character, and watch where the
 * next one lands.** The readout under each field shows where the caret ended up.
 */
class Watched extends Component<{
  id: string;
  title: string;
  hint: string;
  transform: (text: string) => string;
  start: string;
}> {
  @state text = this.props.start;
  @state caret = 0;
  @state length = 0;

  onInput(event: Event) {
    const field = event.target as HTMLInputElement;
    this.text = this.props.transform(field.value);
    // Read after the render, which is where the caret has landed.
    queueMicrotask(() => {
      this.caret = field.selectionStart ?? -1;
      this.length = field.value.length;
    });
  }

  render() {
    return (
      <section style={{ margin: "0 0 1.5rem", padding: "0.75rem", border: "1px solid #ccc" }}>
        <h3 style={{ margin: "0 0 0.25rem" }}>{this.props.title}</h3>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.9em", color: "#555" }}>{this.props.hint}</p>
        <input
          id={this.props.id}
          value={this.text}
          oninput={this.onInput}
          style={{ fontSize: "1.2rem", padding: "0.35rem", width: "20rem" }}
        />
        <p style={{ margin: "0.5rem 0 0", fontFamily: "monospace" }}>
          caret {String(this.caret)} of {String(this.length)}
        </p>
      </section>
    );
  }
}

const group = (text: string) => text.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export class CaretPage extends Component {
  render() {
    return (
      <div style={{ padding: "1rem", maxWidth: "40rem" }}>
        <h2>The caret in a controlled field</h2>
        <p>
          Click in the MIDDLE of each field, type a character, then type another. Watch whether the second one lands
          beside the first or jumps to the end.
        </p>

        <Watched
          id="echo"
          title="1 — the model echoes the input"
          hint="Nothing is written, so nothing can move the caret. Expect it to stay where you typed."
          start="abcdef"
          transform={(text) => text}
        />

        <Watched
          id="upper"
          title="2 — the model rewrites, same length"
          hint="Uppercased. The value changes, so it IS written — and the caret should still stay."
          start="ABCDEF"
          transform={(text) => text.toUpperCase()}
        />

        <Watched
          id="money"
          title="3 — the model rewrites and the length changes"
          hint="Grouped with commas. This one is NOT fixed on purpose: the caret goes to the end, and an app that formats has to place it itself."
          start="1234567"
          transform={group}
        />

        <Watched
          id="numeric"
          title="4 — a field with no caret at all"
          hint="type=number, where setSelectionRange throws. Nothing to keep; it must simply not break."
          start="1"
          transform={(text) => text}
        />
      </div>
    );
  }
}
