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

/* Written lazily, once, into an empty variable: a write like any other — a reader that read it empty keeps that. */
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

/* Filled lazily by a handler after a reader read the empty value: stale. */
let dismissed = false;
export function dismiss(): void {
  dismissed ||= true;
}

/* Counted by every instance's field initializer, after the first one rendered: stale. */
let created = 0;

/* Written in a static block, while the class is being made: never stale. */
let seeded = 0;

/* A second helper filling the same slot: a second writer. */
function pct(n: number): string {
  fmt ??= { format: String };
  return `${fmt.format(n)}%`;
}

/* An object with a getter, returned: the getter is not run by whoever calls this. */
function makeView() {
  return {
    get since() {
      return Date.now() - lastSaved;
    },
  };
}

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

/* A base whose method reads a field; a subclass overriding it reads nothing. */
class PricedBase extends Component {
  rate = 2;
  priced(): number {
    return this.rate;
  }
  bump(): void {
    this.rate = 3;
  }
  render() {
    return <p />;
  }
}
/* Not reported: the base's `priced` never runs on this class. */
class Overrides extends PricedBase {
  override priced(): number {
    return 1;
  }
  overridden = this.use(Takes, (self: Overrides) => ({ value: self.priced() }));
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

  /* REPORTED — a lazy first value, in a variable or behind a getter, is a write like any other. */
  lazy = this.use(Takes, () => ({ value: money(1) + config() }));
  lazyGetter = this.use(Takes, (self: Cart) => ({ value: self.api }));
  /* Not reported: handlers handed back, which the reader does not run. */
  handlers = this.use(Takes, () => ({ value: makeActions() }));

  /* REPORTED — a lazy write the reader does not make, after it read the empty value. */
  notDismissed = this.use(Takes, () => ({ value: !dismissed }));
  /* REPORTED — `fmt` read here before `money` fills it: the reader holds the empty value. */
  eager = this.use(Takes, () => ({ value: (fmt ? "a" : "b") + money(1) }));
  /* REPORTED — `created`, which every later instance's field initializer moves. */
  id = ++created;
  ofTotal = this.use(Takes, (self: Cart) => ({ value: `${self.id} of ${created}` }));
  /* REPORTED — a getter destructured from the owner runs as `self.shown` does. */
  destructured = this.use(Takes, ({ shown }: Cart) => ({ value: shown }));
  /* REPORTED — a getter that writes a field is a writer like any other. */
  counted = this.use(Takes, (self: Cart) => ({ value: self.counter }));

  /* REPORTED — the function a getter returns, called through it. */
  returned = this.use(Takes, (self: Cart) => ({ value: self.fmt() }));
  /* REPORTED — a method handed to a call that runs it. */
  passed = this.use(Takes, (self: Cart) => ({ value: [1, 2].map(self.format) }));
  /* REPORTED — a `function` field called through the owner, whose `this` is the instance there. */
  boundFunction = this.use(Takes, (self: Cart) => ({ value: self.calc() }));
  /* REPORTED — `this.build`, the nearest member of that name, an arrow field (declared before its use). */
  build = (self: Cart) => ({ value: self.rate });
  builtByField = this.use(Takes, this.build);
  /* REPORTED — a script's global, which any script can assign. */
  global = this.use(Takes, () => ({ value: scriptTheme }));
  /* Not reported: a `function` field destructured — its `this` is undefined there, so it reads nothing of
     this instance; and a field written only by a field initializer, before the first render. */
  unboundFunction = this.use(Takes, ({ calc }: Cart) => ({ value: calc() }));
  initialised = this.use(Takes, (self: Cart) => ({ value: self.seq }));
  /* REPORTED — an arrow field, destructured and called. */
  destructuredArrow = this.use(Takes, ({ pricedArrow }: Cart) => ({ value: pricedArrow() }));
  /* REPORTED — a field written through a pattern. */
  toned = this.use(Takes, (self: Cart) => ({ value: self.tone }));
  /* REPORTED — a destructured method, called: bound to the instance, it runs as `self.priced2()` would. */
  destructuredMethod = this.use(Takes, ({ priced2 }: Cart) => ({ value: priced2() }));

  /* REPORTED — two helpers filling one slot; a lazy memo inside a `.map`; a method's lazy memo. */
  twoHelpers = this.use(Takes, () => ({ value: money(1) + pct(2) }));
  nestedLazy = this.use(Takes, (self: Cart) => ({ value: self.prices() }));
  methodMemo = this.use(Takes, (self: Cart) => ({ value: self.api2().base }));

  /* Not reported: a getter in an object handed back; a field only a static method writes, through the
     class's `this`; a static block's write; a handler a getter returns. */
  view = this.use(Takes, () => ({ value: makeView() }));
  staticWrite = this.use(Takes, (self: Cart) => ({ value: self.note2 }));
  quietSeeded = this.use(Takes, () => ({ value: seeded }));
  quietHandler = this.use(Takes, (self: Cart) => ({ value: self.onSave }));

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

  /* REPORTED — an arrow kept in a local and called: it keeps the instance's `this`. */
  @compute get local(): number {
    const price = (n: number) => n * this.rate;
    return price(this.tick);
  }

  /* REPORTED — `this.fnGetter()` runs the getter, and the getter reads `rate`. */
  @compute get viaFnGetter(): number {
    return this.fnGetter();
  }

  get fnGetter() {
    const r = this.rate;
    return () => r;
  }

  pricedArrow = () => this.rate;

  get fmt() {
    return () => this.rate;
  }
  format(n: number): number {
    return n * this.rate;
  }
  calc = function (this: Cart | void): number {
    return this ? this.rate : 0;
  };
  seq = 0;
  first = this.seq++;

  @compute get doubled(): number {
    return this.tick * 2;
  }

  get shown(): number {
    return this.rate;
  }

  static {
    seeded = 1;
  }

  priced2(): number {
    return this.rate;
  }

  private fmt2?: { format(n: number): string };
  prices(): string[] {
    return [1, 2].map((i) => (this.fmt2 ??= { format: String }).format(i));
  }

  /* Written through a pattern by a handler. */
  tone = "a";
  setTone(next: string): void {
    [this.tone] = [next];
  }

  note2 = "";
  static clear(this: { note2: string }): void {
    this.note2 = "";
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
