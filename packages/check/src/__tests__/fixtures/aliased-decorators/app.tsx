import { Component, Host, bootstrap, created, state } from "@ramonda/core";
import { created as onCreate, state as reactive } from "@ramonda/core";

/** Written the ordinary way — every rule here reports something. */
@Host("div")
class Plain extends Component {
  @state items: string[] = [];
  @state n = 0;

  @created
  start() {
    this.n = 1;
  }

  add(row: string) {
    this.items.push(row);
  }

  render() {
    this.n = 2;
    return <div>{this.items.length}</div>;
  }
}

/** The same class, with both decorators imported under another name. */
@Host("div")
class Aliased extends Component {
  @reactive items: string[] = [];
  @reactive n = 0;

  @onCreate
  start() {
    this.n = 1;
  }

  add(row: string) {
    this.items.push(row);
  }

  render() {
    this.n = 2;
    return <div>{this.items.length}</div>;
  }
}

bootstrap(<Plain />, null);
bootstrap(<Aliased />, null);
