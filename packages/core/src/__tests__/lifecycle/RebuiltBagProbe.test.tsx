import { describe, test, expect, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
const out: string[] = [];
afterAll(() =>
  writeFileSync(
    "/tmp/claude-1000/-home-nikola-Blasko-ramonda-monorepo-2/7e5c833c-d47a-4057-9963-f74bce61a390/scratchpad/probe.txt",
    out.join("\n"),
  ),
);
import { getDOM } from "../../test/setup";
import { Component } from "../../base/Component";
import { Hook } from "../../base/Hook";
import { compute, state, updated, watchProp } from "../../base/decorators";

describe("what a rebuilt bag does downstream", () => {
  test("A: @watchProp on a rebuilt array fires on every render", async () => {
    let fired = 0;
    class Watcher extends Hook<{ items: readonly number[]; id: number }> {
      @watchProp((p: { items: readonly number[] }) => p.items)
      onItems() {
        fired++;
      }
    }
    class Panel extends Component {
      @state unrelated = 0;
      w = this.use(Watcher, () => ({ items: [1, 2, 3], id: 7 }));
      render() {
        return <div>{String(this.unrelated)}</div>;
      }
    }
    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();
    out.push(["A watchProp fired:", fired].join(" "));
    expect(fired).toBeGreaterThan(0);
  });

  test("B: a watchProp on a rebuilt array that WRITES state — does it fold or loop?", async () => {
    let renders = 0;
    class Watcher extends Hook<{ items: readonly number[] }> {
      @state seen = 0;
      @watchProp((p: { items: readonly number[] }) => p.items)
      onItems() {
        this.seen = this.seen + 1;
      }
    }
    class Panel extends Component {
      @state unrelated = 0;
      w = this.use(Watcher, () => ({ items: [1, 2, 3] }));
      render() {
        renders++;
        return <div>{`${this.w.seen}:${this.unrelated}`}</div>;
      }
    }
    const { instance, settle } = await getDOM<Panel>(<Panel />);
    const afterMount = renders;
    instance.unrelated = 1;
    await settle();
    out.push(["B renders: mount", afterMount, "after one change", renders].join(" "));
    expect(renders).toBeLessThan(10);
  });

  test("C: @updated in a hook that writes state — post-render write", async () => {
    let runs = 0;
    class After extends Hook<{ items: readonly number[] }> {
      @state seen = 0;
      @updated
      afterRender() {
        runs++;
        if (runs < 20) this.seen = this.seen + 1;
      }
    }
    class Panel extends Component {
      @state unrelated = 0;
      w = this.use(After, () => ({ items: [1] }));
      render() {
        return <div>{`${this.w.seen}:${this.unrelated}`}</div>;
      }
    }
    const { instance, settle } = await getDOM<Panel>(<Panel />);
    out.push(["C @updated runs after mount:", runs].join(" "));
    instance.unrelated = 1;
    await settle();
    out.push(["C @updated runs:", runs].join(" "));
    expect(runs).toBeGreaterThan(0);
  });

  test("E: the compute READS the rebuilt prop while computing — the cascade", async () => {
    let bystanderRenders = 0;
    let computeRuns = 0;
    class Wrapper extends Hook<{ onSave: () => void }> {
      @compute get handler() {
        computeRuns++;
        const fn = this.props.onSave; // read WHILE computing → a dependency
        return () => fn();
      }
    }
    class Bystander extends Component<{ onSave: () => void }> {
      render() {
        bystanderRenders++;
        return (
          <button type="button" onClick={this.props.onSave}>
            b
          </button>
        );
      }
    }
    class Panel extends Component {
      @state unrelated = 0;
      w = this.use(Wrapper, (self: Panel) => ({
        onSave: () => {
          self.unrelated = 0;
        },
      }));
      render() {
        return (
          <div>
            {String(this.unrelated)}
            <Bystander onSave={this.w.handler} />
          </div>
        );
      }
    }
    const { instance, settle } = await getDOM<Panel>(<Panel />);
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();
    out.push(["E compute runs", computeRuns, "| bystander renders", bystanderRenders, "(3 parent renders)"].join(" "));
    expect(bystanderRenders).toBeGreaterThan(0);
  });

  test("D: a derived function from a rebuilt bag, passed to a child", async () => {
    let childRenders = 0;
    let bystanderRenders = 0;
    class Wrapper extends Hook<{ onSave: () => void }> {
      @compute get handler() {
        return () => this.props.onSave();
      }
    }
    class Child extends Component<{ onSave: () => void; label: string }> {
      render() {
        childRenders++;
        return (
          <button type="button" onClick={this.props.onSave}>
            {this.props.label}
          </button>
        );
      }
    }
    class Bystander extends Component<{ onSave: () => void }> {
      render() {
        bystanderRenders++;
        return (
          <button type="button" onClick={this.props.onSave}>
            b
          </button>
        );
      }
    }
    class Panel extends Component {
      @state unrelated = 0;
      w = this.use(Wrapper, (self: Panel) => ({
        onSave: () => {
          self.unrelated = 0;
        },
      }));
      render() {
        return (
          <div>
            <Child onSave={this.w.handler} label={`x${this.unrelated}`} />
            <Bystander onSave={this.w.handler} />
          </div>
        );
      }
    }
    const { instance, settle } = await getDOM<Panel>(<Panel />);
    const afterMount = childRenders;
    instance.unrelated = 1;
    await settle();
    instance.unrelated = 2;
    await settle();
    out.push(
      ["D child renders: mount", afterMount, "total", childRenders, "| bystander total", bystanderRenders].join(" "),
    );
    expect(childRenders).toBeGreaterThan(0);
  });
});
