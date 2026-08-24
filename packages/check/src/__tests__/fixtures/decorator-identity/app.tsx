import { Component, bootstrap, persist, state, state as reactive } from "@ramonda/core";
import * as core from "@ramonda/core";
import { Host as asHost } from "@ramonda/core";
import { persist as ourOwn } from "./own";
import { OursUnderItsOwnName } from "./ours";

/** ✗ The plain pair: `@state` already serializes, so `@persist` adds nothing. */
class Plain extends Component {
  @state
  @persist
  n = 1;
  render() {
    return null;
  }
}

/** ✗ The same pair with core's `state` under an ALIAS. */
class Aliased extends Component {
  @reactive
  @persist
  n = 1;
  render() {
    return null;
  }
}

/** ✗ And through a NAMESPACE import. */
class Namespaced extends Component {
  @core.state
  @core.persist
  n = 1;
  render() {
    return null;
  }
}

/** ✓ An app's own `persist` beside core's `@state` claims nothing of core's. */
class OwnDecorator extends Component {
  @state
  @ourOwn
  n = 1;
  render() {
    return null;
  }
}

/** ✗ `@Host` twice on one class — the sibling rule's report, through a NAMESPACE. */
@core.Host("div")
@core.Host("section")
class HostTwiceNamespaced extends Component {
  render() {
    return null;
  }
}

/** ✗ And with core's `Host` under an alias. */
@asHost("div")
@asHost("section")
class HostTwiceAliased extends Component {
  render() {
    return null;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Plain />
        <Aliased />
        <Namespaced />
        <OwnDecorator />
        <OursUnderItsOwnName />
        <HostTwiceNamespaced />
        <HostTwiceAliased />
      </div>
    );
  }
}

bootstrap(<App />, null);
