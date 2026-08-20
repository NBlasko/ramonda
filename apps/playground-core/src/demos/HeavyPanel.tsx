import { Component, Host, state } from "@ramonda/core";

/**
 * The "heavy" module. Nothing here is heavy — what matters is that it lives in
 * its own file, so the bundler splits it out and it is fetched only when
 * AsyncLoad asks for it. Open the Network tab and watch it arrive on click.
 */
@Host("div")
export default class HeavyPanel extends Component<{ title?: string }> {
  @state clicks = 0;
  bump() {
    this.clicks++;
  }
  render() {
    return (
      <div className="heavy">
        <p className="label">loaded module</p>
        <strong>{this.props.title ?? "HeavyPanel"}</strong>
        <p className="muted small">A real component with its own state — it was not part of the initial bundle.</p>
        <button onclick={this.bump}>clicked {this.clicks}×</button>
      </div>
    );
  }
}
