import { Component, Hook, bootstrap, compute, state } from "@ramonda/core";

class Takes extends Hook<{ value: unknown }> {}

/* A module variable a function writes after the module has run. */
let lang = "en";
export function setLang(next: string): void {
  lang = next;
}

/* A module variable written only while the module is first evaluated: never stale. */
let theme = "light";
theme = "dark";

/* A constant: never stale. */
const PREFIX = "Total: ";

/* A function this program declares, reading the variable `setLang` writes. */
function label(): string {
  return `${PREFIX}${lang}`;
}

/* A function with a local of its own, written inside it: a local, not a variable outside. */
function counted(): number {
  let n = 0;
  n += 1;
  return n;
}

/* Props callbacks declared away from their `this.use`. */
function makeProps(self: Cart) {
  return { value: self.rate };
}
const buildProps = (self: Cart) => ({ value: self.rate });

/**
 * Cached readers reaching what goes stale by every path a writer can take — and the paths that
 * cannot go stale beside them.
 */
class Cart extends Component {
  @state tick = 0;
  /* An ordinary field, written by a handler after the first render. */
  rate = 2;

  /* REPORTED — the variable, read directly in a props callback. */
  direct = this.use(Takes, () => ({ value: lang }));
  /* REPORTED — the variable, read through a function this program declares. */
  throughAFunction = this.use(Takes, () => ({ value: label() }));
  /* REPORTED — the field, through a callback declared as a function elsewhere. */
  named = this.use(Takes, makeProps);
  /* REPORTED — the field, through a callback declared as a constant elsewhere. */
  namedConst = this.use(Takes, buildProps);
  /* REPORTED — the field, through a method handed over as the callback. */
  method = this.use(Takes, this.props_);
  /* REPORTED — the field, through a getter. */
  getter = this.use(Takes, (self: Cart) => ({ value: self.shown }));

  /* Not reported: written only at module evaluation, a constant, a local, a @compute. */
  quietTheme = this.use(Takes, () => ({ value: theme }));
  quietConst = this.use(Takes, () => ({ value: PREFIX }));
  quietLocal = this.use(Takes, () => ({ value: counted() }));
  quietCompute = this.use(Takes, (self: Cart) => ({ value: self.doubled }));
  /* Not reported: a local declared inside the callback itself. */
  quietOwnLocal = this.use(Takes, () => {
    let own = 1;
    own += 1;
    return { value: own };
  });

  /* REPORTED — a @compute reading the variable through a function. */
  @compute get title(): string {
    return label();
  }

  @compute get doubled(): number {
    return this.tick * 2;
  }

  get shown(): number {
    return this.rate;
  }

  props_(self: Cart) {
    return { value: self.rate };
  }

  bump(): void {
    this.rate = 3;
  }

  render() {
    return <p>{this.title}</p>;
  }
}

bootstrap(<Cart />, null);
