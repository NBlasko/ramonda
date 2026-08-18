import { bootstrap, Component, created, mounted } from "@ramonda/core";

/** REPORTED — awaits, and nothing here could catch a failure. */
export class Unguarded extends Component {
  @mounted async load() {
    await fetch("/posts");
  }
  render() {
    return <p>a</p>;
  }
}

/** Not reported: the try is the whole point. */
export class Guarded extends Component {
  @mounted async load() {
    try {
      await fetch("/posts");
    } catch {
      // handled
    }
  }
  render() {
    return <p>b</p>;
  }
}

/** Not reported: an async method with no await can only throw synchronously. */
export class NoAwait extends Component {
  @created async init() {
    this.x = 1;
  }
  x = 0;
  render() {
    return <p>c</p>;
  }
}

/** Not reported: not a lifecycle at all. */
export class PlainAsync extends Component {
  async fetchMore() {
    await fetch("/more");
  }
  render() {
    return <p>d</p>;
  }
}

export class App extends Component {
  render() {
    return (
      <main>
        <Unguarded />
        <Guarded />
        <NoAwait />
        <PlainAsync />
      </main>
    );
  }
}

bootstrap(<App />, null);
