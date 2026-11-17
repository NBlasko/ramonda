import { Component, Hook, bootstrap, compute, state } from "@ramonda/core";
import { readOther } from "./other";

declare function createApi(): { base: string };
declare function load(): string;

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

/* Written lazily, once, into an empty variable: never stale. */
let fmt: { format(n: number): string } | undefined;
function money(n: number): string {
  fmt ??= { format: String };
  return fmt.format(n);
}
let loaded: string | undefined;
function config(): string {
  if (!loaded) loaded = load();
  return loaded;
}

/* Lazy, but filled by a handler after a reader read the empty value: stale. */
let dismissed = false;
export function dismiss(): void {
  dismissed ||= true;
}

/* Counted by every instance's field initializer, after the first one rendered: stale. */
let created = 0;

/* Written in a static block, while the class is being made: never stale. */
let seeded = 0;

/* A function returning handlers: the handlers are not run by whoever calls it. */
let lastSaved = 0;
function makeActions() {
  return {
    save: () => {
      lastSaved = Date.now();
    },
    since: () => Date.now() - lastSaved,
  };
}

/* Written through a pattern or a loop: stale like any other write. */
let first = "en";
export function setFirst(next: string[]): void {
  [first] = next;
}
let region = "rs";
export function setRegion(cfg: { region: string }): void {
  ({ region } = cfg);
}
let unit = "px";
export function cycle(list: string[]): void {
  for (unit of list) void unit;
}

/* A `count` here and another in `./other.ts`, each written later: two variables, both stale. */
let count = 0;
export function bump(): void {
  count++;
}
function readHere(): number {
  return count;
}

/* A class made in a function, its variable written there — before the class exists. */
export function makeCard(o: { size?: number }) {
  let size = o.size ?? 0;
  size = Math.max(size, 10);
  class SizedCard extends Component {
    @compute get px(): number {
      return (size ?? 0) * 2;
    }
    render() {
      return <p>{this.px}</p>;
    }
  }
  return SizedCard;
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

  /* REPORTED — written through an array pattern, an object pattern, a `for…of`. */
  pattern = this.use(Takes, () => ({ value: first }));
  objectPattern = this.use(Takes, () => ({ value: region }));
  loop = this.use(Takes, () => ({ value: unit }));
  /* REPORTED twice — two variables named `count`, one in each module. */
  counts = this.use(Takes, () => ({ value: readHere() + readOther() }));

  /* Not reported: a lazy first value, in a variable or behind a getter; handlers handed back. */
  lazy = this.use(Takes, () => ({ value: money(1) + config() }));
  lazyGetter = this.use(Takes, (self: Cart) => ({ value: self.api }));
  handlers = this.use(Takes, () => ({ value: makeActions() }));

  /* REPORTED — a lazy write the reader does not make, after it read the empty value. */
  shown = this.use(Takes, () => ({ value: !dismissed }));
  /* REPORTED — `fmt` read here before `money` fills it: the reader holds the empty value. */
  eager = this.use(Takes, () => ({ value: (fmt ? "a" : "b") + money(1) }));
  /* REPORTED — `created`, which every later instance's field initializer moves. */
  id = ++created;
  ofTotal = this.use(Takes, (self: Cart) => ({ value: `${self.id} of ${created}` }));
  /* REPORTED — a getter destructured from the owner runs as `self.shown` does. */
  destructured = this.use(Takes, ({ shown }: Cart) => ({ value: shown }));
  /* REPORTED — a getter that writes a field it does not fill lazily is a writer like any other. */
  counted = this.use(Takes, (self: Cart) => ({ value: self.counter }));

  /* Not reported: a static block's write, a handler a getter returns, a method's lazy memo. */
  quietSeeded = this.use(Takes, () => ({ value: seeded }));
  quietHandler = this.use(Takes, (self: Cart) => ({ value: self.onSave }));
  quietMethodMemo = this.use(Takes, (self: Cart) => ({ value: self.api2().base }));

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

  static {
    seeded = 1;
  }

  counter = 0;
  get nextId(): number {
    return this.counter++;
  }

  draft = "";
  get onSave() {
    return () => this.persist(this.draft);
  }
  persist(_text: string): void {}
  edit(text: string): void {
    this.draft = text;
  }

  private _api2?: { base: string };
  api2() {
    return (this._api2 ??= createApi());
  }

  private _api?: { base: string };
  get api() {
    return (this._api ??= createApi());
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
