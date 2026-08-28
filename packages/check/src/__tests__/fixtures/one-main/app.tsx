import { Component, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
declare const editing: boolean;
declare const kind: string;

/** ✗ Two in one render — the layout owns one and the page adds another. */
class TwoMains extends Component {
  render() {
    return (
      <div>
        <main>content</main>
        <main>more</main>
      </div>
    );
  }
}

/** ✗ The commonest shape: one tag, one role, neither author seeing the other. */
class TagAndRole extends Component {
  render() {
    return (
      <div>
        <main>content</main>
        <div role="main">more</div>
      </div>
    );
  }
}

/** ✓ One arm each: that is one landmark on the page. */
class OneInEachArm extends Component {
  render() {
    return <div>{editing ? <main>edit</main> : <main>read</main>}</div>;
  }
}

/** ✓ The specification's own escape. */
class SecondIsHidden extends Component {
  render() {
    return (
      <div>
        <main>content</main>
        <main hidden>print copy</main>
      </div>
    );
  }
}

/** ✗ `hidden={false}` says out loud that it is shown, so it excuses nothing. */
class HiddenIsFalse extends Component {
  render() {
    return (
      <div>
        <main>content</main>
        <main hidden={false}>more</main>
      </div>
    );
  }
}

/** ✓ A spread may be carrying the `hidden` that settles it. */
class SecondSpreads extends Component {
  render() {
    return (
      <div>
        <main>content</main>
        <main {...rest}>more</main>
      </div>
    );
  }
}

/** ✓ A `role` this cannot read may be anything, including one that is not a landmark. */
class RoleIsUnreadable extends Component {
  render() {
    return (
      <div>
        <main>content</main>
        <div role={kind}>more</div>
      </div>
    );
  }
}

/** ✓ One is one, however deeply it is nested. */
class JustOne extends Component {
  render() {
    return (
      <div>
        <section>
          <main>content</main>
        </section>
      </div>
    );
  }
}

/** ✓ A second RENDER is a second page, and they are never on it together. */
class AnotherView extends Component {
  render() {
    return <main>a different route</main>;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <TwoMains />
        <TagAndRole />
        <OneInEachArm />
        <SecondIsHidden />
        <HiddenIsFalse />
        <SecondSpreads />
        <RoleIsUnreadable />
        <JustOne />
        <AnotherView />
      </div>
    );
  }
}

bootstrap(<App />, null);
