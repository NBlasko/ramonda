import { Component, Hook, bootstrap } from "../framework";

declare function pickComponent(): unknown;

class Counter extends Hook {
  n = 0;
}

class Reader extends Component {
  render() {
    return <span>x</span>;
  }
}

/**
 * A component under another name, which IS followed: one hop to what the name was declared with,
 * the same hop a loader, a binding and a factory's registry already get.
 */
const Named = Reader;

/** Chosen by a call, so there is nothing to read where it is declared. */
const Alias = pickComponent();

const Recorded = pickComponent();
const Bare = pickComponent();

class App extends Component {
  counter = this.use(Counter);
  render() {
    return (
      <div>
        <Named />
        {/* `{Named}` renders nothing, and the runtime says nothing either. */}
        {Named}
        <Alias />
        {/* ramonda-check-ignore the component is chosen at run time here, and this is why */}
        <Recorded />
        {/* ramonda-check-ignore */}
        <Bare />
      </div>
    );
  }
}

bootstrap(<App />, null);
