import { Component, Host, bootstrap, state } from "../framework";

/**
 * A project that trips exactly ONE rule and nothing else.
 *
 * Every other fixture reports something from the graph as well — an unreachable declaration, a
 * consumer with no provider, a name that could not be followed — so none of them can answer the
 * question this one exists for: does the "everything is fine" line stay quiet when the ONLY thing
 * wrong is a rule's finding?
 *
 * It is deliberately dull. One component, mounted from one root, no contexts, no lazy imports,
 * nothing unreachable. The single fault is the doubled `@state`, which is `duplicate-decorators`
 * and nothing else.
 */
@Host("div")
class Panel extends Component {
  // Applied twice, which changes nothing about how it behaves — that is the point of the report.
  @state @state count = 0;

  render() {
    return <span>{this.count}</span>;
  }
}

bootstrap(<Panel />, null);
