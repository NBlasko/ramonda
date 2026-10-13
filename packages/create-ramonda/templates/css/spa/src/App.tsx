import { Component, state } from "@ramonda/core";

// Each `@@( … )` is a style block: real CSS for one element, compiled to classes at build time.
// `$color.accent` and the rest are the tokens declared in ramonda.css.ts.

const spin = @@keyframes(
  to {
    transform: rotate(360deg);
  }
);

const page = @@(
  min-height: $size.screen;
  display: grid;
  place-items: center;
  background-color: $color.page;
  color: $color.text;
);

const card = @@(
  box-sizing: border-box;
  max-width: $size.card;
  margin: $space.l;
  padding: $space.xl;
  text-align: center;
  background-color: $color.surface;
  border: $size.line solid $color.line;
  border-radius: $radius.l;
);

const mark = @@(
  display: block;
  margin: 0 auto $space.m;
  color: $color.accent;
  animation: $(spin) 9000ms linear infinite;
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
);

const title = @@(
  margin: 0;
  font-size: $font.l;
);

const tagline = @@(
  margin: $space.s 0 $space.l;
  color: $color.muted;
  line-height: 1.6;
);

const button = @@(
  font: inherit;
  font-weight: 600;
  color: $color.onAccent;
  background-color: $color.accent;
  border: none;
  border-radius: $radius.m;
  padding: $space.m $space.l;
  cursor: pointer;
  &:hover {
    filter: brightness(1.08);
  }
  &:focus-visible {
    outline: $size.focus solid $color.accent;
    outline-offset: $space.xs;
  }
);

const hint = @@(
  margin: $space.l 0 $space.m;
  color: $color.muted;
  font-size: $font.s;
  line-height: 1.5;
);

const code = @@(
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background-color: $color.code;
  padding: $space.xs $space.s;
  border-radius: $radius.s;
);

const docs = @@(
  color: $color.accent;
  font-weight: 600;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
);

// A component is a class, and what it renders is what appears. `@state` marks a signal:
// changing it re-renders the component.
export class App extends Component {
  @state count = 0;

  increment(): void {
    this.count = this.count + 1;
  }

  render() {
    return (
      <div className={page}>
        <main className={card}>
          <svg className={mark} viewBox="-32 -32 64 64" width="64" height="64" aria-hidden="true">
            <g fill="currentColor">
              <ellipse cx="0" cy="-14" rx="8.6" ry="14" />
              <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(72)" />
              <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(144)" />
              <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(216)" />
              <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(288)" />
            </g>
            <circle r="6.6" fill="#e9b44c" />
          </svg>
          <h1 className={title}>Ramonda</h1>
          <p className={tagline}>Explicit. Predictable. Readable.</p>

          <button type="button" className={button} onclick={this.increment}>
            count is {this.count}
          </button>

          <p className={hint}>
            Edit <code className={code}>src/App.tsx</code> and save — the count survives the reload.
          </p>

          <a className={docs} href="https://ramonda.dev" target="_blank" rel="noreferrer">
            Read the docs →
          </a>
        </main>
      </div>
    );
  }
}
