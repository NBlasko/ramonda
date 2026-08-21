import { Component, bootstrap, createContext, list } from "@ramonda/core";

const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

class Cell extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <td>x</td>;
  }
}

/**
 * A row's component, written in the callback `list()` takes.
 *
 * The options object with its `as` is gone from core, so this is how a list mounts a component
 * now — and the tag is written here, in the component the list sits in, which is exactly where the
 * row mounts. The ordinary JSX walk reads it; there is nothing special left to do.
 */
class Table extends Component {
  render() {
    return (
      <table>
        {list([1, 2, 3], (n: number) => (
          <Cell />
        ))}
      </table>
    );
  }
}

class App extends Component {
  render() {
    return <Table />;
  }
}

bootstrap(<App />, null);
