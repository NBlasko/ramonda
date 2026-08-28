import { Component, bootstrap } from "@ramonda/core";

declare function go(): void;
declare const kind: string;
declare const rest: Record<string, unknown>;

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ Declared a control, and a keyboard cannot reach it at all. */}
        <div role="button" onclick={go}>
          Save
        </div>
        {/* ✗ Reachable, and Enter and Space do nothing. */}
        <div role="button" tabIndex={0} onclick={go}>
          Save
        </div>
        {/* ✗ The verbatim spelling of the click is the same handler. */}
        <div role="link" tabIndex={0} on:click={go}>
          Go
        </div>

        {/* ✓ The whole path, built by hand. */}
        <div role="button" tabIndex={0} onclick={go} onkeydown={go}>
          Save
        </div>
        {/* ✓ The verbatim spelling of the key handler counts too. */}
        <div role="button" tabIndex={0} onclick={go} on:keydown={go}>
          Save
        </div>
        {/* ✓ `tabIndex={-1}` is somebody reaching for a tab order deliberately. */}
        <div role="button" tabIndex={-1} onclick={go} onkeydown={go}>
          Save
        </div>

        {/* ✓ A native control needs none of this written on it. */}
        <button type="button" onclick={go}>
          Save
        </button>
        {/* ✓ Not a widget role — announced as text, which is another rule's report. */}
        <div role="note" onclick={go}>
          Note
        </div>
        {/* ✓ A role this cannot read may not be a widget at all. */}
        <div role={kind} onclick={go}>
          x
        </div>
        {/* ✓ A spread may carry the `tabIndex` or the key handler. */}
        <div role="button" onclick={go} {...rest}>
          Save
        </div>
        {/* ✓ A real control inside gives the keyboard somewhere to land. */}
        <div role="button" onclick={go}>
          <button type="button">Save</button>
        </div>
        {/* ✓ No pointer handler at all: nothing says the mouse was wired and the keyboard was not. */}
        <div role="button" tabIndex={0}>
          Save
        </div>
      </div>
    );
  }
}

bootstrap(<App />, null);
