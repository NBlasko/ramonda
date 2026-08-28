import { Component, bootstrap, persist, state, state as reactive } from "@ramonda/core";
import * as core from "@ramonda/core";
import { ShouldUpdateOnPropsChange as asGate } from "@ramonda/core";
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

/** ✗ A single-use class decorator twice — the sibling rule's report, through a NAMESPACE. */
@core.ShouldUpdateOnPropsChange(() => true)
@core.ShouldUpdateOnPropsChange(() => false)
class GateTwiceNamespaced extends Component {
  render() {
    return null;
  }
}

/** ✗ And with core's own decorator under an alias. */
@asGate(() => true)
@asGate(() => false)
class GateTwiceAliased extends Component {
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
        <GateTwiceNamespaced />
        <GateTwiceAliased />
      </div>
    );
  }
}

bootstrap(<App />, null);
