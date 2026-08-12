import { Component, bootstrap } from "../framework";
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

class App extends Component {
  render() {
    return (
      <div>
        <Covered />
        <Bare />
      </div>
    );
  }
}

bootstrap(<App />, null);
