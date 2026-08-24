import { Component, Host, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
const NONE = "none";

@Host("div")
class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ A tag that is focusable on its own. */}
        <button type="button" role="presentation">
          go
        </button>

        {/* ✗ The synonym says the same thing. */}
        <input type="text" role="none" />

        {/* ✗ A `<div>` put in the tab order by hand. */}
        <div role="presentation" tabIndex={0}>
          panel
        </div>

        {/* ✗ The role one hop away, which the reader follows. */}
        <div role={NONE} tabIndex={0}>
          panel
        </div>

        {/* ✓ Taken back OUT of the tab order, which is one of the two fixes. */}
        <button type="button" role="presentation" tabIndex={-1}>
          go
        </button>

        {/* ✓ Not focusable at all: scaffolding a keyboard cannot reach. */}
        <div role="presentation">panel</div>

        {/* ✓ An `<a>` with no `href` is not focusable. */}
        <a role="presentation">not a link</a>

        {/* ✗ And one WITH an href is. */}
        <a href="/x" role="presentation">
          a link
        </a>

        {/* ✓ A hidden input is not focusable. */}
        <input type="hidden" role="presentation" />

        {/* ✓ A tabIndex this cannot read says nothing either way. */}
        <div role="presentation" tabIndex={rest.n as number}>
          panel
        </div>

        {/* ✓ A spread AFTER the role may replace it. */}
        <button type="button" role="presentation" {...rest}>
          go
        </button>

        {/* ✓ A spread on a tag-focusable element may be carrying `tabIndex={-1}`. */}
        <button type="button" {...rest} role="presentation">
          go
        </button>

        {/* ✗ But a written tabIndex a spread cannot reach over is still provable. */}
        <div {...rest} role="presentation" tabIndex={0}>
          panel
        </div>

        {/* ✓ A role that is not presentational is nobody's business here. */}
        <button type="button" role="switch" aria-checked="false">
          go
        </button>
      </div>
    );
  }
}

/** ✗ The same role written where a component configures its own element. */
@Host("button", () => ({ role: "presentation" }))
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
