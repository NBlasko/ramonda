import { Component, state } from "@ramonda/core";

/**
 * The "heavy" module. Nothing here is heavy — what matters is that it lives in
 * its own file, so the bundler splits it out and it is fetched only when
 * AsyncLoad asks for it. Open the Network tab and watch it arrive on click.
 *
 * **The style block is here on purpose.** A block belongs to the module it was
 * written in, and each module imports its own stylesheet — so a route that is
 * already code-split gets its own CSS from a decision the bundler makes anyway.
 * `scripts/check-css-splitting.mjs` builds this app and asserts it: two
 * stylesheets, and no rule in both.
 */
export default class HeavyPanel extends Component<{ title?: string }> {
  @state clicks = 0;
  bump() {
    this.clicks++;
  }
  render() {
    return (
      <div>
        <div className="heavy" css={@(
          outline: 2px dashed #7c3aed;
          outline-offset: 4px;
        )}>
          <p className="label">loaded module</p>
          <strong>{this.props.title ?? "HeavyPanel"}</strong>
          <p className="muted small">A real component with its own state — it was not part of the initial bundle.</p>
          <button onclick={this.bump}>clicked {this.clicks}×</button>
        </div>
      </div>
    );
  }
}
