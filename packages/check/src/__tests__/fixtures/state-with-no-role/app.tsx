import { Component, Host, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
declare const open: boolean;
declare const kind: string;

@Host("div")
class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ The commonest shape of it: a custom dropdown wired up correctly, announcing nothing. */}
        <div aria-expanded={open}>menu</div>

        {/* ✗ A `<span>` is the same. */}
        <span aria-checked="true">tick</span>

        {/* ✗ Two on one element are two reports, because each is its own line to delete. */}
        <div aria-selected="true" aria-level="2">
          row
        </div>

        {/* ✓ GLOBAL attributes work on anything, role or no role. */}
        <div aria-label="Filters" aria-describedby="hint" aria-busy="true">
          panel
        </div>

        {/* ✓ `aria-hidden` is global AND does something here — it takes the subtree out. */}
        <div aria-hidden="true">decorative</div>

        {/* ✓ A role written, so the state has something to belong to. */}
        <div role="button" aria-expanded={open}>
          menu
        </div>

        {/* ✓ A role this cannot READ is still a role. */}
        <div role={kind} aria-expanded={open}>
          menu
        </div>

        {/* ✓ A tag with an implicit role of its own is not this rule's — it needs the table. */}
        <button type="button" aria-expanded={open}>
          menu
        </button>

        {/* ✓ A misspelling is `unknown-aria-attribute`'s report, not a second one here. */}
        <div aria-expandd={open}>menu</div>

        {/* ✓ A spread may be carrying the `role` that makes it mean something. */}
        <div {...rest} aria-expanded={open}>
          menu
        </div>
      </div>
    );
  }
}

/** ✗ The same state written where a component configures its own element. */
@Host("div", () => ({ "aria-expanded": "true" }))
class ConfiguredHost extends Component {
  render() {
    return <span>host</span>;
  }
}

bootstrap(
  <div>
    <App />
    <ConfiguredHost />
  </div>,
  null,
);
