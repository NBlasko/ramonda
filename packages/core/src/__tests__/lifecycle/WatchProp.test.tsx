import { describe, test, expect, beforeEach } from "vitest";
import { getDOM } from "../../test/setup";
import { state, watchProp } from "../../base/decorators";
import { Component } from "../../base/Component";

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
});
