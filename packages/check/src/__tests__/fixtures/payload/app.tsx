import { Component, bootstrap } from "../framework";
import { Header } from "./header";

declare class AsyncLoad extends Component {}

/** In the first payload, and reached by both chunks as well — so it is free to either of them. */
class Shell extends Component {
  render() {
    return (
      <div>
        <Header />
        <Left />
        <Right />
      </div>
    );
  }
}

class Left extends Component {
  private static readonly load = () => import("./chunks/left");
  render() {
    return <AsyncLoad lazy={Left.load} namedExport="Page" />;
  }
}

class Right extends Component {
  render() {
    return <AsyncLoad lazy={() => import("./chunks/right")} namedExport="Page" />;
  }
}

/** The same chunk named from a second place: one download, so one split point and not two. */
class Aside extends Component {
  render() {
    return <AsyncLoad lazy={() => import("./chunks/left")} namedExport="Page" />;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Shell />
        <Aside />
      </div>
    );
  }
}

bootstrap(<App />, null);
