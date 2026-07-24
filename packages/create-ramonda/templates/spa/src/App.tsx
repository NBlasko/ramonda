import { Component, Host, state } from "@ramonda/core";

// A component is a class. `@Host("main")` says the element this component *is* —
// here a <main>. `@state` marks a signal: changing it re-renders the component.
@Host("main")
export class App extends Component {
  @state count = 0;

  increment(): void {
    this.count = this.count + 1;
  }

  render() {
    return (
      <div className="card">
        <svg className="mark" viewBox="-32 -32 64 64" width="64" height="64" aria-hidden="true">
          <g fill="currentColor">
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" />
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(72)" />
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(144)" />
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(216)" />
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(288)" />
          </g>
          <circle r="6.6" fill="#e9b44c" />
        </svg>
        <h1>Ramonda</h1>
        <p className="tagline">A TypeScript UI framework — class components, signals, and TC39 decorators.</p>

        <button type="button" onClick={this.increment}>
          count is {this.count}
        </button>

        <p className="hint">
          Edit <code>src/App.tsx</code> and save — the count survives the reload.
        </p>

        <a className="docs" href="https://ramonda.pages.dev" target="_blank" rel="noreferrer">
          Read the docs →
        </a>
      </div>
    );
  }
}
