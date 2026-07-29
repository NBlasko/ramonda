import { Component, createContext } from "@ramonda/core";

/**
 * `label` is optional and DEV-only: it names the pair in devtools
 * ("ThemeProvider" / "ThemeConsumer" instead of a bare "Provider" / "Consumer").
 */
export const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

export class ThemedBadge extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span className="badge">context theme: {this.ctx.theme}</span>;
  }
}
