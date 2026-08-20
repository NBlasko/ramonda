import { Component, Host, state, createContext } from "@ramonda/core";

// createContext returns a [Provider, Consumer] pair. The provider publishes to
// its whole subtree; a consumer anywhere below reads it, without the value being
// threaded through every component in between.
//
// Reads are per KEY, so a component reading only `theme` is not re-rendered when
// some other key on the same context changes. A key the provider does not supply
// falls back to the default declared here.
const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light", accent: "pink" }, { label: "Theme" });

@Host("span")
class ThemedBadge extends Component {
  // No props, no wiring from the parent — it reads the context directly.
  private ctx = this.use(ThemeConsumer);

  render() {
    return (
      <span className={`demo-badge demo-badge-${this.ctx.theme}`}>
        {this.ctx.theme} / {this.ctx.accent}
      </span>
    );
  }
}

@Host("div")
class Toolbar extends Component {
  // Deliberately knows nothing about the theme — it just renders a child that does.
  render() {
    return (
      <p className="demo-row">
        <span className="demo-note">a component two levels down:</span>
        <ThemedBadge />
      </p>
    );
  }
}

@Host("div")
export class ThemeContextDemo extends Component {
  @state theme = "light";

  private provider = this.use(ThemeProvider, (self: ThemeContextDemo) => ({
    theme: self.theme,
    accent: self.theme === "light" ? "pink" : "cyan",
  }));

  toggle() {
    this.theme = this.theme === "light" ? "dark" : "light";
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <button type="button" onclick={this.toggle}>
            toggle theme
          </button>
        </p>
        <Toolbar />
      </div>
    );
  }
}
