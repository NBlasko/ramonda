import { Component, Host, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;

/**
 * The element a component IS, and every fault the family knows written on it.
 *
 * This is where a component CONFIGURES its own element, and until the family read it, not one of
 * these five was reported by anything — while the identical five on a `<div>` were all reported.
 */
@Host("div", () => ({
  role: "buton",
  "aria-lablled": "Filters",
  tabIndex: 5,
  class: "card",
  accessKey: "s",
}))
class Configured extends Component {
  render() {
    return <span>configured</span>;
  }
}

/** The control: the same five on a tag. */
@Host("div")
class Written extends Component {
  render() {
    return <div role="buton" aria-lablled="Filters" tabIndex={5} class="card" accessKey="s" />;
  }
}

/** The block body, which is the second spelling of one callback and was read by nothing first. */
@Host("div", () => {
  return { role: "buton" };
})
class BlockBody extends Component {
  render() {
    return <span>block</span>;
  }
}

/** Shorthand, the third spelling. */
const role = "buton";

@Host("div", () => ({ role }))
class Shorthand extends Component {
  render() {
    return <span>shorthand</span>;
  }
}

/**
 * A tag chosen per props, so the ELEMENT is not knowable — but the attributes are, and a bad
 * `aria-` name is bad on every tag it could be.
 */
@Host(
  (p: { as?: string }) => p.as ?? "div",
  () => ({ "aria-lablled": "Filters" }),
)
class Polymorphic extends Component<{ as?: string }> {
  render() {
    return <span>polymorphic</span>;
  }
}

/** A spread in the props bag reaches over what came before it, exactly as it does on a tag. */
@Host("div", () => ({ role: "buton", ...rest }))
class SpreadLast extends Component {
  render() {
    return <span>spread last</span>;
  }
}

/** And cannot reach what comes after. */
@Host("div", () => ({ ...rest, role: "buton" }))
class SpreadFirst extends Component {
  render() {
    return <span>spread first</span>;
  }
}

/** No props bag at all: nothing to read, and nothing said. */
@Host("div")
class Bare extends Component {
  render() {
    return <span>bare</span>;
  }
}

@Host("div")
class App extends Component {
  render() {
    return (
      <div>
        <Configured />
        <Written />
        <BlockBody />
        <Shorthand />
        <Polymorphic />
        <SpreadLast />
        <SpreadFirst />
        <Bare />
      </div>
    );
  }
}

bootstrap(<App />, null);
