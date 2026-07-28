import { describe, test, expect, beforeEach } from "vitest";
import { getDOM } from "../../test/setup";
import { state, watchProp } from "../../base/decorators";
import { Component } from "../../base/Component";
import { Hook } from "../../base/Hook";

let log: string[] = [];

beforeEach(() => {
  log = [];
});

describe("watchProp", () => {
  test("ne okida na mount-u; okida na promeni prop-a sa (new, old) i sinkuje state u istom renderu", async () => {
    class Child extends Component<{ value: number }> {
      @state mirror = -1;

      @watchProp((p: { value: number }) => p.value)
      onValue(next: number, prev: number) {
        log.push(`watch:${prev}->${next}`);
        this.mirror = next;
      }

      render() {
        log.push(`render:${this.props.value}:${this.mirror}`);
        return <div>{this.mirror}</div>;
      }
    }

    class Root extends Component {
      @state value = 1;
      render() {
        return <Child value={this.value} />;
      }
    }

    const { instance, settle } = await getDOM<Root>(<Root />);

    // Mount: render se desio, watchProp NIJE okinuo.
    expect(log).toEqual(["render:1:-1"]);

    log = [];

    // Promena prop-a iz roditelja.
    instance.value = 5;
    await settle();

    // watchProp okida pre rendera; mirror je sinkovan u ISTOM renderu (jedan prolaz).
    expect(log).toEqual(["watch:1->5", "render:5:5"]);
  });

  test("a deep selector fires only for its own value, not for an unrelated prop", async () => {
    interface Props {
      data: { v: number };
      other: number;
    }

    class Child extends Component<Props> {
      @watchProp((p: Props) => p.data.v)
      onV(next: number, prev: number) {
        log.push(`v:${prev}->${next}`);
      }

      render() {
        return <div>{this.props.other}</div>;
      }
    }

    class Root extends Component {
      @state data = { v: 10 };
      @state other = 0;
      render() {
        return <Child data={this.data} other={this.other} />;
      }
    }

    const { instance, settle } = await getDOM<Root>(<Root />);
    expect(log).toEqual([]);

    // Menjamo nepovezan prop -> izabrana vrednost (data.v) ista -> ne okida.
    instance.other = 1;
    await settle();
    expect(log).toEqual([]);

    // Change the nested value -> it fires.
    instance.data = { v: 20 };
    await settle();
    expect(log).toEqual(["v:10->20"]);
  });

  test("a selector reaching a value that is not there returns undefined instead of crashing", async () => {
    interface Props {
      value: number;
      maybe?: { deep?: { leaf: number } };
    }

    class Child extends Component<Props> {
      // Namerno bez optional chaining-a: p.maybe.deep.leaf puca kada maybe ne postoji.
      @watchProp((p: Props) => (p.maybe as { deep: { leaf: number } }).deep.leaf)
      onLeaf(next: number, prev: number) {
        log.push(`leaf:${prev}->${next}`);
      }

      render() {
        return <div>{this.props.value}</div>;
      }
    }

    class Root extends Component {
      @state value = 1;
      render() {
        return <Child value={this.value} />;
      }
    }

    const { instance, container, settle } = await getDOM<Root>(<Root />);

    // Mount succeeded despite the throwing selector.
    expect(container.textContent).toContain("1");

    // The update survives too; the selector keeps returning undefined, and an
    // unchanged value means no callback.
    instance.value = 2;
    await settle();

    expect(container.textContent).toContain("2");
    expect(log).toEqual([]);
  });

  /**
   * On a hook, `@watchProp` watches the HOOK's props — the bag its `this.use()`
   * callback produces.
   *
   * It did not until 2026-07-28, and the failure was silent. A hook shares its
   * owner's runtime, so `runtime.watchProps` holds the component's entries and
   * every hook's in one list, and running that list handed all of them the
   * COMPONENT's `rawProps`. So a hook selecting `p => p.userId` read the owner's
   * `userId`, and its own prop changing fired nothing at all. Each entry now
   * records the instance it was declared on; see `WatchPropEntry.owner`.
   */
  test("a hook's watchProp watches the hook's own props, not the owner's", async () => {
    interface LoaderProps {
      /**
       * Named differently from anything `Panel` has, and derived rather than
       * forwarded — both on purpose. An earlier version of this test called the
       * hook's prop `userId` too, so the OLD behaviour (every entry handed the
       * component's props) read the owner's `userId`, fired with the same numbers,
       * and the test passed while the bug was still there.
       */
      target: string;
    }

    class Loader extends Hook<LoaderProps> {
      @state loaded = "none";

      @watchProp((p: LoaderProps) => p.target)
      onTarget(next: string, previous: string) {
        log.push(`hook:${previous}->${next}`);
        this.loaded = `loaded-${next}`;
      }
    }

    class Panel extends Component<{ userId: number; theme: string }> {
      loader = this.use(Loader, (self: Panel) => ({ target: `/users/${self.props.userId}` }));

      render() {
        log.push(`render:${this.loader.loaded}:${this.props.theme}`);
        return <div>{this.loader.loaded}</div>;
      }
    }

    class Root extends Component {
      @state userId = 1;
      @state theme = "light";
      render() {
        return <Panel userId={this.userId} theme={this.theme} />;
      }
    }

    const { instance, container, settle } = await getDOM<Root>(<Root />);

    expect(log).toEqual(["render:none:light"]);
    log = [];

    // The hook's own prop moves: it fires, and the derived state is in place for
    // the very render that follows — one pass, which is the reason to use
    // `@watchProp` over an `@effect` here.
    instance.userId = 2;
    await settle();
    expect(log).toEqual(["hook:/users/1->/users/2", "render:loaded-/users/2:light"]);
    expect(container.textContent).toContain("loaded-/users/2");

    log = [];

    // A prop of the OWNER that the hook does not receive: the owner re-renders, and
    // the hook's watcher stays quiet.
    instance.theme = "dark";
    await settle();
    expect(log).toEqual(["render:loaded-/users/2:dark"]);
  });

  test("three levels of nested hooks each watch their own props", async () => {
    // The list `runWatchProps` walks holds the component's entries and every
    // hook's, at every depth. Each one has to pick out its own bag.
    interface LeafProps {
      leaf: string;
    }
    interface MiddleProps {
      middle: number;
    }
    interface OuterProps {
      outer: string;
    }

    class Leaf extends Hook<LeafProps> {
      @watchProp((p: LeafProps) => p.leaf)
      onLeaf(next: string, previous: string) {
        log.push(`leaf:${previous}->${next}`);
      }
    }

    class Middle extends Hook<MiddleProps> {
      leaf = this.use(Leaf, (self: Middle) => ({ leaf: `L${self.props.middle * 2}` }));

      @watchProp((p: MiddleProps) => p.middle)
      onMiddle(next: number, previous: number) {
        log.push(`middle:${previous}->${next}`);
      }
    }

    class Outer extends Hook<OuterProps> {
      middle = this.use(Middle, (self: Outer) => ({ middle: self.props.outer.length }));

      @watchProp((p: OuterProps) => p.outer)
      onOuter(next: string, previous: string) {
        log.push(`outer:${previous}->${next}`);
      }
    }

    class Panel extends Component<{ word: string }> {
      outer = this.use(Outer, (self: Panel) => ({ outer: self.props.word }));

      render() {
        return <div>{this.props.word}</div>;
      }
    }

    class Root extends Component {
      @state word = "ab";
      render() {
        return <Panel word={this.word} />;
      }
    }

    const { instance, settle } = await getDOM<Root>(<Root />);
    expect(log).toEqual([]);

    // One prop change at the top cascades: each level's callback fires with the
    // values of ITS OWN bag, derived from the level above.
    instance.word = "abcd";
    await settle();

    expect(log).toEqual(["outer:ab->abcd", "middle:2->4", "leaf:L4->L8"]);
    log = [];

    // A change that only reaches the top two: the leaf's value is derived from
    // `middle`, which does not move, so its watcher stays quiet.
    instance.word = "wxyz";
    await settle();
    expect(log).toEqual(["outer:abcd->wxyz"]);
  });

  test("two hooks of the same class watch their own props, not each other's", async () => {
    // The entries live in ONE list keyed by instance, so two instances of the same
    // class are the case most likely to be confused for each other.
    interface FeedProps {
      url: string;
    }

    class Feed extends Hook<FeedProps> {
      @watchProp((p: FeedProps) => p.url)
      onUrl(next: string, previous: string) {
        log.push(`${previous}->${next}`);
      }
    }

    class Panel extends Component<{ a: number; b: number }> {
      left = this.use(Feed, (self: Panel) => ({ url: `/a/${self.props.a}` }));
      right = this.use(Feed, (self: Panel) => ({ url: `/b/${self.props.b}` }));

      render() {
        return <div>{`${this.props.a}${this.props.b}`}</div>;
      }
    }

    class Root extends Component {
      @state a = 1;
      @state b = 1;
      render() {
        return <Panel a={this.a} b={this.b} />;
      }
    }

    const { instance, settle } = await getDOM<Root>(<Root />);
    log = [];

    instance.a = 2;
    await settle();
    // Only the left one moved.
    expect(log).toEqual(["/a/1->/a/2"]);

    log = [];
    instance.b = 5;
    await settle();
    expect(log).toEqual(["/b/1->/b/5"]);
  });

  test("a deep selector works on a hook's props", async () => {
    interface TableProps {
      filters: { page: number; tag: string };
    }

    class Table extends Hook<TableProps> {
      @watchProp((p: TableProps) => p.filters.page)
      onPage(next: number, previous: number) {
        log.push(`page:${previous}->${next}`);
      }
    }

    class Panel extends Component<{ page: number; tag: string }> {
      // A NEW object every render — the case a shallow comparison would fire on
      // every time, and the reason `watchProp` compares the SELECTED value.
      table = this.use(Table, (self: Panel) => ({
        filters: { page: self.props.page, tag: self.props.tag },
      }));

      render() {
        return <div>{this.props.tag}</div>;
      }
    }

    class Root extends Component {
      @state page = 1;
      @state tag = "x";
      render() {
        return <Panel page={this.page} tag={this.tag} />;
      }
    }

    const { instance, settle } = await getDOM<Root>(<Root />);
    log = [];

    instance.page = 2;
    await settle();
    expect(log).toEqual(["page:1->2"]);

    log = [];
    // The bag is a fresh object again, but `page` did not move.
    instance.tag = "y";
    await settle();
    expect(log).toEqual([]);
  });

  test("a hook's watchProp fires for a prop derived from the owner's state", async () => {
    // Not every prop comes from the component's own props — this is the other
    // source, and it goes through the same update pass.
    class Search extends Hook<{ term: string }> {
      @state hits = 0;

      @watchProp((p: { term: string }) => p.term)
      onTerm(next: string) {
        log.push(`term:${next}`);
        this.hits = next.length;
      }
    }

    class Panel extends Component {
      @state typed = "a";
      search = this.use(Search, (self: Panel) => ({ term: self.typed }));

      render() {
        log.push(`render:${this.search.hits}`);
        return <div>{this.search.hits}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    expect(log).toEqual(["render:0"]);
    log = [];

    instance.typed = "abc";
    await settle();

    // Fires before the render, and the state it writes is in place for that same
    // render — one pass, which is the reason `@watchProp` exists next to `@effect`.
    expect(log).toEqual(["term:abc", "render:3"]);
  });

  test("state written by a hook's watchProp reaches a NESTED hook's props on the next pass", async () => {
    /**
     * Measured behaviour, not a wish — and worth pinning down because it is the
     * one place the single-pass guarantee stops.
     *
     * `updateBuild` runs the hook update pass FIRST (every hook's props callback,
     * outer to inner), then `runWatchProps`, then the render. So a `@watchProp`
     * callback that writes state runs AFTER the props of every hook below it were
     * computed. The component's own render sees the new value; a nested hook whose
     * props derive from it does not, until the next render.
     *
     * The write does not schedule that next render either — `inBuildQueue` is still
     * set while watchProps run, which is deliberate (it is what keeps the write from
     * costing a second pass). So the nested hook catches up on whatever render comes
     * next, and this test drives one.
     */
    class Inner extends Hook<{ doubled: number }> {
      @watchProp((p: { doubled: number }) => p.doubled)
      onDoubled(next: number, previous: number) {
        log.push(`inner:${previous}->${next}`);
      }
    }

    class Outer extends Hook<{ seed: number }> {
      @state derived = 0;
      inner = this.use(Inner, (self: Outer) => ({ doubled: self.derived * 2 }));

      @watchProp((p: { seed: number }) => p.seed)
      onSeed(next: number) {
        log.push(`outer:${next}`);
        this.derived = next;
      }
    }

    class Panel extends Component {
      @state seed = 1;
      @state nudge = 0;
      outer = this.use(Outer, (self: Panel) => ({ seed: self.seed }));

      render() {
        log.push(`render:${this.outer.derived}:${this.nudge}`);
        return <div>{this.outer.derived}</div>;
      }
    }

    const { instance, settle } = await getDOM<Panel>(<Panel />);
    log = [];

    instance.seed = 4;
    await settle();

    // `derived` is 4 in this render, but `Inner`'s props were computed before the
    // callback ran — so it has not seen 8 yet.
    expect(log).toEqual(["outer:4", "render:4:0"]);
    log = [];

    // Any later render runs the hook pass again, and the nested watcher catches up.
    instance.nudge = 1;
    await settle();
    expect(log).toEqual(["inner:0->8", "render:4:1"]);
  });

  test("a component's watchProp still reads the component's props with hooks present", async () => {
    // The other half of the same fix: one shared list, two kinds of owner. A
    // regression here would mean components started reading a hook's bag.
    class Noise extends Hook<{ tick: number }> {
      @watchProp((p: { tick: number }) => p.tick)
      onTick(next: number) {
        log.push(`hook:${next}`);
      }
    }

    class Panel extends Component<{ label: string }> {
      noise = this.use(Noise, { tick: 0 });

      @watchProp((p: { label: string }) => p.label)
      onLabel(next: string, previous: string) {
        log.push(`component:${previous}->${next}`);
      }

      render() {
        return <div>{this.props.label}</div>;
      }
    }

    class Root extends Component {
      @state label = "a";
      render() {
        return <Panel label={this.label} />;
      }
    }

    const { instance, settle } = await getDOM<Root>(<Root />);
    log = [];

    instance.label = "b";
    await settle();

    expect(log).toEqual(["component:a->b"]);
  });
});
