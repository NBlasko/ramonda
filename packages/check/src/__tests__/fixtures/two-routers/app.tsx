import { Component, bootstrap, createContext } from "../framework";

/** Two of these conflict, so the author says so once, here. */
const [RouteProvider, RouteConsumer] = createContext({ path: "/" }, { label: "Route", single: true });

/** Nesting is ordinary for this one: the nearer Provider wins, which is what an override is. */
const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

class Reader extends Component {
  route = this.use(RouteConsumer);
  theme = this.use(ThemeConsumer);
  render() {
    return <span>x</span>;
  }
}

/** A second Route, below one that is already live. */
class Inner extends Component {
  route = this.use(RouteProvider);
  panelTheme = this.use(ThemeProvider);
  render() {
    return <Reader />;
  }
}

class App extends Component {
  route = this.use(RouteProvider);
  theme = this.use(ThemeProvider);
  render() {
    return <Inner />;
  }
}

bootstrap(<App />, null);
