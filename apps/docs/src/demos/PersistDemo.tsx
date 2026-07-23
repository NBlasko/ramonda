import { Component, Host, persist, state, create } from "@ramonda/core";

// @persist marks a field as part of the hydration payload without making it a
// signal. @state fields travel automatically; @persist is for set-once values
// that render but never change.
//
// This page was prerendered, so the value below was computed on the SERVER at
// build time, serialized into the HTML, and restored here before any client
// lifecycle ran. Reload the page: it does not change, because nothing on the
// client ever computes it.
//
// The `env: "server"` matters. A shared @create would run again on the client and
// overwrite what the server sent, which is how a value silently stops being the
// one the HTML shipped.
@Host("div")
export class PersistDemo extends Component {
  @persist builtAt = "";
  @state clientRuns = 0;

  @create({ env: "server" })
  stampOnServer() {
    this.builtAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  }

  @create({ env: "client" })
  countClientRuns() {
    this.clientRuns = this.clientRuns + 1;
  }

  render() {
    return (
      <p className="demo-row">
        <span>
          prerendered at <strong>{this.builtAt || "(not prerendered)"}</strong> UTC
        </span>
        <span className="demo-note">
          client @create ran {this.clientRuns} time(s) — the value above came from the server
        </span>
      </p>
    );
  }
}
