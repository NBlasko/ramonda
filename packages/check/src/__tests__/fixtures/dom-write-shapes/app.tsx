import { Component, bootstrap, mounted } from "@ramonda/core";

/** ✗ The plain case, as the control. */
class Plain extends Component {
  @mounted()
  lock() {
    document.body.style.overflow = "hidden";
  }
  render() {
    return null;
  }
}

/** ✗ Through `globalThis`, which the checker knows whatever the lib settings are. */
class ViaGlobalThis extends Component {
  @mounted()
  lock() {
    globalThis.document.body.style.overflow = "hidden";
  }
  render() {
    return null;
  }
}

/** ✗ The document DESTRUCTURED — the same write, one name away. */
class Destructured extends Component {
  @mounted()
  lock() {
    const { body } = document;
    body.style.overflow = "hidden";
  }
  render() {
    return null;
  }
}

/** ✗ Optional chaining on a query, which is how it is usually written. */
class OptionalChained extends Component {
  @mounted()
  paint() {
    document.getElementById("banner")?.classList.add("open");
  }
  render() {
    return null;
  }
}

/** ✓ A COMMAND has no declarative form and stays allowed. */
class Commands extends Component {
  @mounted()
  focusIt() {
    document.getElementById("field")?.focus();
    document.getElementById("row")?.scrollIntoView();
  }
  render() {
    return null;
  }
}

/** ✓ An element the component made itself is its own business. */
class OwnElement extends Component {
  @mounted()
  make() {
    const node = document.createElement("div");
    node.style.overflow = "hidden";
    node.classList.add("mine");
  }
  render() {
    return null;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Plain />
        <ViaGlobalThis />
        <Destructured />
        <OptionalChained />
        <Commands />
        <OwnElement />
      </div>
    );
  }
}

bootstrap(<App />, null);
