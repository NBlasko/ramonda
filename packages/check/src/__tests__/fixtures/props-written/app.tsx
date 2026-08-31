import { Component, Hook, bootstrap, state } from "@ramonda/core";

declare const incoming: { label: string; rows: string[]; meta: { seen: boolean } };

class Panel extends Component<{ label: string; rows: string[]; meta: { seen: boolean } }> {
  @state open = false;

  /* REPORTED — a plain assignment to a prop. */
  rename() {
    this.props.label = "changed";
  }

  /* REPORTED — a compound assignment is a write too. */
  append() {
    this.props.label += "!";
  }

  /* REPORTED — so is `delete`. */
  drop() {
    delete this.props.label;
  }

  /* REPORTED — and so is an increment, which reads like neither. */
  bump() {
    (this.props as { n: number }).n++;
  }

  /* REPORTED — one hop: the same object through a local, which the proxy guards just the same. */
  viaLocal() {
    const p = this.props;
    p.label = "changed";
  }

  /* REPORTED — a computed key is still a key on props. */
  byKey(which: "label") {
    this.props[which] = "changed";
  }

  /* Silent: mutating something props POINT AT is a different fault — the proxy guards the props
     object itself, and `meta` is not it. */
  mutateNested() {
    this.props.meta.seen = true;
    this.props.rows.push("x");
  }

  /* Silent: a destructured value is a local, and writing it writes nothing of the component's. */
  destructured() {
    let { label } = this.props;
    label = "a local, not a prop";
    return label;
  }

  /* Silent: reading is the whole point of props. */
  read() {
    return this.props.label;
  }

  /* Silent: a DIFFERENT object that happens to be called props. */
  elsewhere() {
    const other = { props: { label: "" } };
    other.props.label = "changed";
    return incoming.label;
  }

  render() {
    return <p>{this.props.label}</p>;
  }
}

/** A hook's props are the same fault one level in — the proxy throws there too. */
class Watcher extends Hook<{ every: number }> {
  /* REPORTED — a hook writing its own props. */
  retune() {
    this.props.every = 10;
  }
}

/** The declaration on a BASE, used from a subclass: reported once, where it is written. */
class Base extends Component<{ title: string }> {
  /* REPORTED — once, here. */
  retitle() {
    this.props.title = "changed";
  }

  render() {
    return <p>{this.props.title}</p>;
  }
}

class Derived extends Base {}

bootstrap(<Panel label="a" rows={[]} meta={{ seen: false }} />, null);
bootstrap(<Derived title="t" />, null);
void Watcher;
