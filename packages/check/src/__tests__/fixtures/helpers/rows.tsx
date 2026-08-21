import { Component, createContext } from "@ramonda/core";

export const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

export class Cell extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>x</span>;
  }
}

/**
 * A helper in another FILE, which is the shape nothing could see before.
 *
 * The tag is written here and mounts wherever this is called, so the edges are the helper's and
 * every caller reaches them.
 */
export function row(): unknown {
  return <Cell />;
}
