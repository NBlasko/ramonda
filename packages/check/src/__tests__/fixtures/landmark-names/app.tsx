import { Component, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;
declare const kind: string;
declare const wide: boolean;

/** ✗ The shape: a primary navigation and a footer navigation, neither named. */
class TwoNavs extends Component {
  render() {
    return (
      <div>
        <nav>
          <a href="/">Home</a>
        </nav>
        <nav>
          <a href="/terms">Terms</a>
        </nav>
      </div>
    );
  }
}

/** ✗ Three of them, and all three are reported — every one needs a name. */
class ThreeNavs extends Component {
  render() {
    return (
      <div>
        <nav>a</nav>
        <nav>b</nav>
        <nav>c</nav>
      </div>
    );
  }
}

/** ✗ A written `role` is certain, and is the same landmark. */
class NavAndRole extends Component {
  render() {
    return (
      <div>
        <nav>a</nav>
        <div role="navigation">b</div>
      </div>
    );
  }
}

/** ✓ Both named, which is the fix. */
class BothNamed extends Component {
  render() {
    return (
      <div>
        <nav aria-label="Primary">a</nav>
        <nav aria-label="Footer">b</nav>
      </div>
    );
  }
}

/** ✓ One named and one not: two different entries in the list, and they CAN be told apart. */
class OneNamed extends Component {
  render() {
    return (
      <div>
        <nav aria-label="Primary">a</nav>
        <nav>b</nav>
      </div>
    );
  }
}

/** ✓ Named by pointing at a heading, which cannot drift apart from it. */
class NamedByHeading extends Component {
  render() {
    return (
      <div>
        <nav aria-labelledby="a">x</nav>
        <nav aria-labelledby="b">y</nav>
      </div>
    );
  }
}

/** ✓ One landmark of a kind has nothing to be told apart FROM. */
class JustOne extends Component {
  render() {
    return (
      <div>
        <nav>a</nav>
        <div role="search">b</div>
      </div>
    );
  }
}

/** ✓ Two DIFFERENT kinds are two different words in the list. */
class TwoKinds extends Component {
  render() {
    return (
      <div>
        <div role="search">a</div>
        <div role="banner">b</div>
      </div>
    );
  }
}

/** ✓ One in each arm of a ternary is one landmark on the page. */
class OneInEachArm extends Component {
  render() {
    return <div>{wide ? <nav>wide</nav> : <nav>narrow</nav>}</div>;
  }
}

/** ✓ A role this cannot READ may be anything, including something that is not a landmark. */
class UnreadableRole extends Component {
  render() {
    return (
      <div>
        <nav>a</nav>
        <div role={kind}>b</div>
      </div>
    );
  }
}

/** ✓ A spread may be carrying the name, or a role that changes what it is. */
class SecondSpreads extends Component {
  render() {
    return (
      <div>
        <nav>a</nav>
        <nav {...rest}>b</nav>
      </div>
    );
  }
}

/** ✓ Two `<main>` is `more-than-one-main`'s report, not a naming problem. */
/** ✗ A name written and left EMPTY names nothing, so both are still announced "navigation". */
class NamedEmpty extends Component {
  render() {
    return (
      <div>
        <nav aria-label="">a</nav>
        <nav aria-label="">b</nav>
      </div>
    );
  }
}

class TwoMains extends Component {
  render() {
    return (
      <div>
        <main>a</main>
        <main>b</main>
      </div>
    );
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <TwoNavs />
        <ThreeNavs />
        <NavAndRole />
        <BothNamed />
        <OneNamed />
        <NamedByHeading />
        <JustOne />
        <TwoKinds />
        <OneInEachArm />
        <UnreadableRole />
        <SecondSpreads />
        <TwoMains />
        <NamedEmpty />
      </div>
    );
  }
}

bootstrap(<App />, null);
