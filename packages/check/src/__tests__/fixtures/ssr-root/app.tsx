import { Component, createContext, renderPage, renderToString } from "../framework";

const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

class Reader extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>x</span>;
  }
}

/**
 * A component with a METHOD called `renderPage`, one line from a real one.
 *
 * Two apps in this repository have exactly this — a component that builds the markup for one page
 * of data. Read by name, `this.renderPage(row)` is a root whose first argument is a row, and the
 * run either invents a root or reports a hole. An entry is called by its own name.
 */
class Listing extends Component {
  renderPage(row: { title: string }) {
    return <li>{row.title}</li>;
  }
  render() {
    return <ul>{this.renderPage({ title: "x" })}</ul>;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Reader />
        <Listing />
      </div>
    );
  }
}

/** No `bootstrap` anywhere: this app is only ever entered from a server. */
export async function handler(): Promise<string> {
  const page = await renderPage(<App />);
  return page.body;
}

export const markup = renderToString(<App />);
