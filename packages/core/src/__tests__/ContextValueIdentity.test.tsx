import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { createContext } from "../base/Context";
import { StableProps, state } from "../base/decorators";

/**
 * An object literal written into a context value.
 *
 * Every prop is a signal, so a rebuilt object is a CHANGED prop — and for a Provider that means
 * every consumer of the key wakes, however far down the tree it sits and however unchanged the
 * contents are. Measured here because `@ramonda/check` reports it from the source
 * (`fresh-object-in-hook-props`), and the rule's whole shape comes from the third row below.
 *
 * A consumer reading ONLY `conf`, while a different key of the same provider moves three times:
 *
 * | the provider's callback | renders after mount | after three changes to `tick` |
 * |---|---|---|
 * | `() => ({ conf: { dense: true }, tick: this.tick })` | 1 | **4** |
 * | the same, with `@StableProps("conf")` on the provider | 1 | **1** |
 * | `() => ({ conf: { dense: true }, tick: 0 })` — reads nothing | 1 | **1** |
 *
 * The third row is why the static rule asks for a REACTIVE read as well as a literal: the callback
 * is cached on the signals it read, so one that reads none is called once, at mount, and the
 * literal inside it keeps one identity for the life of the component. `apps/playground-core` relies
 * on exactly that for its query defaults, and a rule reporting it would report correct code.
 */
let consumerRenders = 0;

const [BaseProvider, Consumer] = createContext({ conf: { dense: false } as { dense: boolean }, tick: 0 });

/**
 * A Provider takes the declaration on a SUBCLASS: `createContext` hands back a class, not a site.
 *
 * This did not type-check until the decorator was taught the shape. `createContext` returns
 * `new (owner, options: T) => BaseHook<T> & Readonly<T>`, and `BaseHook` carries no props phantom,
 * so the decorator fell through to its COMPONENT branch and read the props off the first
 * parameter — which is the runtime. It worked perfectly at runtime the whole time, which is the
 * worst way for a gate to be wrong: the fix below is the one the docs and `@ramonda/check` both
 * recommend, and it was a compile error.
 */
@StableProps("conf")
class SettledProvider extends BaseProvider {}

class Badge extends Component {
  ctx = this.use(Consumer);
  render() {
    consumerRenders++;
    return <span>{String(this.ctx.conf.dense)}</span>;
  }
}

/** Ticks an owner three times and answers how many times the CONSUMER rendered in total. */
async function consumerRendersOver(Owner: new (...args: any[]) => Component & { tick: number }) {
  consumerRenders = 0;
  const dom = await getDOM<Component & { tick: number }>(<Owner />);
  await dom.settle();

  for (let tick = 1; tick <= 3; tick++) {
    dom.instance.tick = tick;
    await dom.settle();
  }

  const total = consumerRenders;
  dom.unmount();
  return total;
}

class Rebuilding extends Component {
  @state tick = 0;
  provider = this.use(BaseProvider, () => ({ conf: { dense: true }, tick: this.tick }));
  render() {
    return <Badge />;
  }
}

class Declared extends Component {
  @state tick = 0;
  provider = this.use(SettledProvider, () => ({ conf: { dense: true }, tick: this.tick }));
  render() {
    return <Badge />;
  }
}

class ReadsNothing extends Component {
  @state tick = 0;
  provider = this.use(BaseProvider, () => ({ conf: { dense: true }, tick: 0 }));
  render() {
    return <Badge />;
  }
}

class ReadsAPlainField extends Component {
  @state tick = 0;
  plain = 1;
  provider = this.use(BaseProvider, () => ({ conf: { dense: true }, tick: this.plain }));
  render() {
    return <Badge />;
  }
}

describe("an object literal as a context value", () => {
  test("wakes a consumer reading a key that never moved", async () => {
    expect(await consumerRendersOver(Rebuilding)).toBe(4);
  });

  test("a declaration on the provider settles it", async () => {
    expect(await consumerRendersOver(Declared)).toBe(1);
  });
});

/**
 * When the callback runs again at all, which is the other half of the fault.
 *
 * It is cached on the SIGNALS it read. A plain field is not a signal, so a callback reading one is
 * called once as surely as a callback reading nothing — and neither rebuilds anything.
 */
describe("the props callback is cached on what it read", () => {
  test("a callback that reads nothing is called once", async () => {
    expect(await consumerRendersOver(ReadsNothing)).toBe(1);
  });

  test("and so is one that reads a plain field", async () => {
    expect(await consumerRendersOver(ReadsAPlainField)).toBe(1);
  });
});

/** A declaration is not a freeze here either: a value that really moves reaches the consumer. */
describe("a declared context key that changes", () => {
  test("still arrives", async () => {
    class Moving extends Component {
      @state dense = false;
      provider = this.use(SettledProvider, () => ({ conf: { dense: this.dense }, tick: 0 }));
      render() {
        return <Badge />;
      }
    }

    consumerRenders = 0;
    const dom = await getDOM<Moving>(<Moving />);
    await dom.settle();

    dom.instance.dense = true;
    await dom.settle();

    expect(consumerRenders).toBe(2);
    expect(dom.container.querySelector("span")?.textContent).toBe("true");
    dom.unmount();
  });
});

/**
 * The same declaration made where the context is CREATED, which is the spelling the docs teach.
 *
 * `createContext` hands back a class rather than a site, so the only way to decorate it was to
 * subclass it — and subclassing to attach a declaration is not what inheritance is for. The option
 * says the same thing at the only place that knows the whole context: its keys are `defaultValue`'s
 * keys, so a name that is not one of them is a mistake this end can SEE, and the decorator cannot.
 *
 * Measured against the rows above: same context, same three ticks, same consumer.
 */
const [SettledAtCreation, SettledAtCreationConsumer] = createContext(
  { conf: { dense: false } as { dense: boolean }, tick: 0 },
  { stableProps: ["conf"] },
);

class BadgeAtCreation extends Component {
  ctx = this.use(SettledAtCreationConsumer);
  render() {
    consumerRenders++;
    return <span>{String(this.ctx.conf.dense)}</span>;
  }
}

class DeclaredAtCreation extends Component {
  @state tick = 0;
  provider = this.use(SettledAtCreation, () => ({ conf: { dense: true }, tick: this.tick }));
  render() {
    return <BadgeAtCreation />;
  }
}

describe("stableProps declared on createContext", () => {
  test("settles a consumer exactly as the decorator does", async () => {
    expect(await consumerRendersOver(DeclaredAtCreation)).toBe(1);
  });

  test("is not a freeze — a key that really moves still arrives", async () => {
    class Moving extends Component {
      @state dense = false;
      provider = this.use(SettledAtCreation, () => ({ conf: { dense: this.dense }, tick: 0 }));
      render() {
        return <BadgeAtCreation />;
      }
    }

    consumerRenders = 0;
    const dom = await getDOM<Moving>(<Moving />);
    await dom.settle();

    dom.instance.dense = true;
    await dom.settle();

    expect(consumerRenders).toBe(2);
    expect(dom.container.querySelector("span")?.textContent).toBe("true");
    dom.unmount();
  });

  /**
   * The names are checked against the DEFAULT VALUE's keys, which is the whole context — a Provider
   * publishes nothing outside them, so a name outside them can never match. Nothing is written at
   * the call site to make this work: `T` is already inferred from the first argument.
   *
   * This case only has to fail to COMPILE, which `@ts-expect-error` asserts. The runtime refusal
   * below is the same question asked again for a caller who has no types.
   */
  test("a name that is not a key of the default value is refused, twice over", () => {
    expect(() =>
      createContext(
        { conf: { dense: false }, tick: 0 },
        // @ts-expect-error — the compile-time half: "cnof" is not a key of the default value.
        { stableProps: ["cnof"] },
      ),
    ).toThrow(/cnof/);
  });
});
