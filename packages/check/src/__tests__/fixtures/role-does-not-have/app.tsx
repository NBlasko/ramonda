import { Component, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
declare const on: boolean;
declare const kind: string;

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ The shape: a toggle built as a button, wired up as a switch. */}
        <div role="button" aria-checked={on}>
          dark mode
        </div>

        {/* ✗ `aria-selected` belongs to `option`, not `menuitem`. */}
        <li role="menuitem" aria-selected="true">
          Copy
        </li>

        {/* ✗ A value on something that is not a range. */}
        <div role="button" aria-valuenow={3}>
          three
        </div>

        {/* ✗ Two on one element are two reports, because each is its own line to delete. */}
        <div role="tab" aria-checked="true" aria-level="2">
          Tab
        </div>

        {/* ✓ The role it does belong to. */}
        <div role="switch" aria-checked={on}>
          dark mode
        </div>
        <li role="option" aria-selected="true">
          Copy
        </li>
        <div role="slider" aria-valuenow={3} aria-valuemin={0} aria-valuemax={10}>
          three
        </div>

        {/* ✓ A role that INHERITS the state — the flattened list is what makes this silent. */}
        <div role="treeitem" aria-checked="true" aria-level="2" aria-selected="true">
          node
        </div>
        <div role="columnheader" aria-sort="ascending" aria-colindex={2}>
          Name
        </div>

        {/* ✓ GLOBAL attributes belong to everything. */}
        <div role="button" aria-label="Save" aria-describedby="hint" aria-disabled="true">
          Save
        </div>

        {/* ✓ An attribute the table does not carry is never judged. */}
        <div role="button" aria-required="true">
          Save
        </div>

        {/* ✓ An unknown role is `unknown-role`'s report, not a second one here. */}
        <div role="buton" aria-checked="true">
          x
        </div>

        {/* ✓ A role this cannot READ may be anything. */}
        <div role={kind} aria-checked="true">
          x
        </div>

        {/* ✓ A fallback CHAIN is a list of alternatives; which one wins is not asked here. */}
        <div role="switch button" aria-checked="true">
          x
        </div>

        {/* ✓ No role at all is `aria-state-with-no-role`'s half. */}
        <div aria-checked="true">x</div>

        {/* ✓ A spread after the role may replace it. */}
        <div role="button" aria-checked="true" {...rest}>
          x
        </div>

        {/* ✗ But a spread BEFORE cannot reach over either of them. */}
        <div {...rest} role="button" aria-checked="true">
          x
        </div>
      </div>
    );
  }
}

bootstrap(
  <div>
    <App />
  </div>,
  null,
);
