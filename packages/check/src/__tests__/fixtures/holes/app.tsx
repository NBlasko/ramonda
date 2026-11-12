import { Component, Hook, bootstrap } from "@ramonda/core";

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

/**
 * And under another name THROUGH A CAST — what a package does to give a class a narrower type:
 * `@ramonda/router` exports `Link` and `Navigator` exactly this way. A cast changes a type, never
 * which class the value is.
 */
const Cast = Reader as unknown as typeof Reader;
const CastHook = Counter as unknown as typeof Counter;

/** Chosen by a call, so there is nothing to read where it is declared. */
const Alias = pickComponent();

const Recorded = pickComponent();
const Bare = pickComponent();

class App extends Component {
  counter = this.use(Counter);
  cast = this.use(CastHook);
  render() {
    return (
      <div>
        <Named />
        <Cast />
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
