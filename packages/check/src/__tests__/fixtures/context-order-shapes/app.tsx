import { Component, bootstrap } from "@ramonda/core";
import { ProvidesOnTheBase, ReadsOnTheBase } from "./base";
import { SizeConsumer, SizeProvider, ThemeProvider } from "./contexts";

/** ✗ The base consumes, this provides — base fields construct first, so the consumer looked early. */
export class ProvidesUnderAReadingBase extends ReadsOnTheBase {
  own = this.use(ThemeProvider, () => ({ color: "amber" }));
  render() {
    return null;
  }
}

/** ✓ The base provides, this consumes. Provider first is the documented arrangement. */
export class ReadsUnderAProvidingBase extends ProvidesOnTheBase {
  mine = this.use(SizeConsumer);
  render() {
    return null;
  }
}

/** ✗ Both halves in ONE field, consumer first. Constructed left to right, same fault. */
export class BothInOneField extends Component {
  pair = { reads: this.use(SizeConsumer), writes: this.use(SizeProvider, () => ({ size: "l" })) };
  render() {
    return null;
  }
}

/** ✗ With a `readonly` modifier, which changes nothing about when it is constructed. */
export class ReadonlyFields extends Component {
  readonly outer = this.use(SizeConsumer);
  readonly own = this.use(SizeProvider, () => ({ size: "l" }));
  render() {
    return null;
  }
}

/** ✗ A `static` field between the two, which is not constructed per instance at all. */
export class WithAStaticBetween extends Component {
  outer = this.use(SizeConsumer);
  static label = "x";
  own = this.use(SizeProvider, () => ({ size: "l" }));
  render() {
    return null;
  }
}

/** ✗ Two PROVIDERS of one context in a single field — the second replaces the first. */
export class ProvidesTwiceInOneField extends Component {
  pair = {
    a: this.use(SizeProvider, () => ({ size: "s" })),
    b: this.use(SizeProvider, () => ({ size: "l" })),
  };
  render() {
    return null;
  }
}

/** ✗ A provider on the base and another here — one instance publishing twice. */
export class ProvidesUnderAProvidingBase extends ProvidesOnTheBase {
  own = this.use(ThemeProvider, () => ({ color: "rose" }));
  render() {
    return null;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <ProvidesUnderAReadingBase />
        <ReadsUnderAProvidingBase />
        <BothInOneField />
        <ReadonlyFields />
        <WithAStaticBetween />
        <ProvidesTwiceInOneField />
        <ProvidesUnderAProvidingBase />
      </div>
    );
  }
}

bootstrap(<App />, null);
