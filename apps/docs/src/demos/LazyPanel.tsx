import { Component, Host, state, AsyncLoad } from "@ramonda/core";
import type { AsyncLoadFailure } from "@ramonda/core";
import { preloads } from "../generated/preloads";

// AsyncLoad loads a module the first time it is rendered. It is an ordinary
// component with the default host, written as a tag like everything else.
//
// The loaded component's own props go in `loadedProps` — they belong to a
// different component and must not share this tag's attributes.
//
// `errorFallback` takes a function so a failure can offer `retry`, the same
// shape ErrorBoundary's `fallback` uses. One shape to learn for the same job.
@Host("div")
export class LazyPanel extends Component {
  // Shown by DEFAULT, and that is the point of this demo. The server awaits the
  // import and renders the panel into the HTML, emits a modulepreload hint for
  // its chunk, and the client adopts those nodes instead of destroying them —
  // the whole chain in one example. Toggle it to watch the module cache work:
  // the second mount needs no request at all.
  @state show = true;

  /**
   * Module constants rather than literals in the JSX. Both are the same on every
   * render, so building them there is a new value each time — a new prop for
   * `AsyncLoad`, and RMD020 reports it. `lazy` also feeds `AsyncLoad`'s module cache
   * key, which defaults to the function's source: a stable reference makes that
   * explicit rather than accidental.
   */
  private static readonly load = () => import("./lazy/HeavyPanel");
  private static readonly loadedProps = { note: "fetched on demand" };

  toggle() {
    this.show = !this.show;
  }

  /**
   * A bound method, not an inline arrow. `errorFallback` is a render prop, and a
   * fresh one on every render is a changed prop for no reason.
   */
  renderError({ error, retry }: AsyncLoadFailure) {
    return (
      <p className="demo-error">
        Could not load it: {String(error)}{" "}
        <button type="button" onclick={retry}>
          retry
        </button>
      </p>
    );
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <button type="button" onclick={this.toggle}>
            {this.show ? "unload it" : "load it again"}
          </button>
          <span className="demo-note">
            open the network tab — the chunk is preloaded from &lt;head&gt; and fetched once
          </span>
        </p>
        {this.show ? (
          <AsyncLoad
            lazy={LazyPanel.load}
            namedExport="HeavyPanel"
            // The chunk URL comes from the build's manifest — see
            // scripts/build-manifest.mjs. Nothing at runtime knows it: the server
            // resolves this import in its own module graph, the browser fetches a
            // hashed file. On a prerendered page the hint means the browser can
            // start fetching from its first parse of <head>, in parallel with the
            // main bundle, instead of after hydration reaches this component.
            preload={preloads.HeavyPanel}
            loadedProps={LazyPanel.loadedProps}
            onLoading={<p className="demo-note">loading…</p>}
            errorFallback={this.renderError}
          />
        ) : null}
      </div>
    );
  }
}
