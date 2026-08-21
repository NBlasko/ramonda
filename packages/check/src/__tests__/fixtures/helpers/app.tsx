import { Component, bootstrap, createRoutes } from "@ramonda/core";
import { row, ThemeProvider } from "./rows";

/** The same thing again, as a const holding an arrow. */
const header = () => <Legend />;

class Legend extends Component {
  render() {
    return <em>legend</em>;
  }
}

class Bare extends Component {
  render() {
    return <div>{row()}</div>;
  }
}

class Covered extends Component {
  p = this.use(ThemeProvider);
  render() {
    return (
      <div>
        {row()}
        {header()}
      </div>
    );
  }
}

/** BOUND, so `collectRouteTable` reads it — and reading it again here would give one mount two owners. */
const table = createRoutes({ "/": <Legend /> });

/** INLINE, so nothing else reads it: the tag belongs to the component that wrote it. */
class Inline extends Component {
  render() {
    return <div>{createRoutes({ "/": <Legend /> })}</div>;
  }
}

/**
 * A helper inside a helper. The inner one owns its tag: walking the outer body whole gave that
 * tag two owners, `inner -> Legend` and `outer -> Legend`, from the same line, with the outer one
 * never writing it — and `outer -> inner` was no edge at all, because a call was read only in a
 * component's body.
 */
function outer(): unknown {
  function inner(): unknown {
    return <Legend />;
  }
  return <div>{inner()}</div>;
}

class Nested extends Component {
  render() {
    return <div>{outer()}</div>;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Covered />
        <Bare />
        <Inline />
        <Nested />
      </div>
    );
  }
}

bootstrap(<App />, null);
