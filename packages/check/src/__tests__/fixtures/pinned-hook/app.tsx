import { bootstrap, Component, createContext } from "../framework";

const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

/**
 * A generic hook used with its type argument NAMED, which is how `Form`, `Query` and `Field` are all
 * documented to be written when the call site cannot infer: `this.use(Form<typeof schema>, …)`.
 *
 * In the AST that first argument is an instantiation expression rather than an identifier, and a hook
 * this tool cannot resolve is one that might provide anything — so the component holding it goes
 * opaque and nothing BELOW it is judged any more. That is the fault this fixture exists for: `Reader`
 * consumes a context nothing provides, and it must still be reported.
 */
declare class Store<T> {
  value: T;
}

class Reader extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>x</span>;
  }
}

class App extends Component {
  store = this.use(Store<string>);
  render() {
    return <Reader />;
  }
}

bootstrap(<App />, null);
