import { Component, Host, state } from "@ramonda/core";

/**
 * A component in its own chunk, loaded on demand. Nothing about it is special —
 * that is the point: `AsyncLoad` takes any component and defers the module.
 */
@Host("div")
export class HeavyPanel extends Component<{ note?: string }> {
  @state loadedAt = new Date().toLocaleTimeString();

  render() {
    return (
      <p className="demo-row">
        <span>
          Loaded at <strong>{this.loadedAt}</strong>.
        </span>
        <span className="demo-note">{this.props.note ?? "its own chunk"}</span>
      </p>
    );
  }
}
