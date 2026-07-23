import { Component } from "@ramonda/core";

export class AboutPage extends Component {
  render() {
    return (
      <div className="page">
        <h2>About</h2>
        <p className="muted">
          One <code>nav.updateState</code> channel, state is the source of truth, URL is rebuilt from it.
        </p>
      </div>
    );
  }
}
