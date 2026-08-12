import { Component, bootstrap, createRoutes } from "../framework";
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

class App extends Component {
  render() {
    return (
      <div>
        <Covered />
        <Bare />
        <Inline />
      </div>
    );
  }
}

bootstrap(<App />, null);
