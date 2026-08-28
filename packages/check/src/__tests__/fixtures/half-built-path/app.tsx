import { Component, bootstrap } from "@ramonda/core";

declare function go(): void;
declare function onKeys(e: unknown): void;
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

        {/* ✗ The whole path built by hand, and nothing announces it as a control. */}
        <div tabIndex={0} onclick={go} onkeydown={go}>
          Save
        </div>
        {/* ✗ Started with a key handler alone — the role is still what a reader is missing first. */}
        <div onclick={go} onkeydown={go}>
          Save
        </div>
        {/* ✓ Nothing started at all is the sibling rule's report, not this one's. */}
        <div onclick={go}>Save</div>

        {/*
          ✓ The W3C's own patterns put the keyboard on the CONTAINER: arrow keys there, and a
          roving `tabIndex={-1}` on each child. Read as elements on their own every one of these
          is a click with no key handler, and reporting them means reporting the recommendation.
        */}
        <ul role="listbox" tabIndex={0} onkeydown={onKeys} aria-label="Pick one">
          <li role="option" tabIndex={-1} onclick={go}>
            One
          </li>
        </ul>
        <div role="toolbar" onkeydown={onKeys} aria-label="Format">
          <div role="button" tabIndex={-1} onclick={go}>
            Bold
          </div>
        </div>
        <div role="tablist" onkeydown={onKeys} aria-label="Sections">
          <div role="tab" tabIndex={-1} onclick={go}>
            First
          </div>
        </div>
      </div>
    );
  }
}

/**
 * ✓ The same composite widget, written the way anyone actually builds one.
 *
 * `Toolbar` renders the `role="toolbar"` and the `onkeydown`, and takes the buttons as children.
 * From inside the rule that ancestor is a capitalised tag with nothing on it.
 */
class Toolbar extends Component<{ children?: unknown }> {
  render() {
    return (
      <div role="toolbar" onkeydown={onKeys} aria-label="Format">
        {this.props.children}
      </div>
    );
  }
}

class Split extends Component {
  render() {
    return (
      <Toolbar>
        <div role="button" tabIndex={-1} onclick={go}>
          Bold
        </div>
      </Toolbar>
    );
  }
}

bootstrap(
  <div>
    <App />
    <Split />
  </div>,
  null,
);
