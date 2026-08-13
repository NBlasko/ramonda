import { Component, bootstrap, list } from "../framework";

/**
 * A ring nothing on it can skip: `Loop` always renders `Half`, and `Half` always renders `Loop`.
 *
 * There is no branch, no callback and no loop anywhere on it, so the first render recurses until
 * the stack gives out — before a page appears, in every build.
 */
class Loop extends Component {
  render() {
    return (
      <div>
        <Half />
      </div>
    );
  }
}

class Half extends Component {
  render() {
    return <Loop />;
  }
}

/** A tree that renders itself once per item, which is how a recursive structure is drawn. */
class Branch extends Component<{ depth: number }> {
  render() {
    return (
      <ul>
        {list([1, 2], () => (
          <Branch depth={this.props.depth - 1} />
        ))}
      </ul>
    );
  }
}

/** And the same thing behind a condition, which can also stop. */
class Maybe extends Component<{ more: boolean }> {
  render() {
    return <div>{this.props.more ? <Maybe more={false} /> : null}</div>;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Loop />
        <Branch depth={2} />
        <Maybe more />
      </div>
    );
  }
}

bootstrap(<App />, null);
