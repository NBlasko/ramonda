import { Component, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
declare const where: string;
declare const kind: string;
declare function go(): void;

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ A link announced as a button: Space scrolls the page instead of activating it. */}
        <a href="/pricing" role="button">
          Pricing
        </a>

        {/* ✓ A destination this cannot read may be `"#"`, which is the other conversation. */}
        <a href={where} role="button">
          Pricing
        </a>

        {/* ✗ The other direction: a button announced as a link goes nowhere. */}
        <button type="button" role="link" onclick={go}>
          Pricing
        </button>

        {/* ✓ The element that matches, both ways round. */}
        <a href="/pricing">Pricing</a>
        <button type="button" onclick={go}>
          Save
        </button>

        {/* ✓ An anchor with no destination is not a link at all — that is
            `link-without-a-destination`, and building a button out of one is a different
            conversation from this rule. */}
        <a role="button" onclick={go}>
          Save
        </a>
        <a href="#" role="button" onclick={go}>
          Save
        </a>

        {/* ✓ A role that agrees with the tag. */}
        <a href="/x" role="link">
          x
        </a>
        <button type="button" role="button">
          x
        </button>

        {/* ✓ A role that is neither — a menu item is the documented menu pattern. */}
        <a href="/x" role="menuitem">
          x
        </a>
        <button type="button" role="tab">
          x
        </button>

        {/* ✓ A role this cannot READ may be anything. */}
        <a href="/x" role={kind}>
          x
        </a>

        {/* ✓ A fallback CHAIN is a list of alternatives. */}
        <a href="/x" role="button link">
          x
        </a>

        {/* ✓ A spread after the role may replace it. */}
        <a href="/x" role="button" {...rest}>
          x
        </a>

        {/* ✗ But a spread BEFORE cannot reach over it. */}
        <a href="/x" {...rest} role="button">
          x
        </a>
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
