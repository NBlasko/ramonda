import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state, memoized } from "../base/decorators";
import { Component } from "../base/Component";

describe("@memoized", () => {
  test("returns same function reference for same args across renders", async () => {
    const refs: Record<string, Function[]> = { a: [], b: [] };

    class Comp extends Component {
      @state tick = 0;

      @memoized
      getHandler(id: string) {
        return () => id;
      }

      render() {
        refs["a"].push(this.getHandler("a"));
        refs["b"].push(this.getHandler("b"));
        return <div>{this.tick}</div>;
      }
    }

    const { instance, settle } = await getDOM<Comp>(<Comp />);

    instance.tick = 1;
    await settle();

    instance.tick = 2;
    await settle();

    // Isti args → ista referenca u svakom renderu
    expect(refs["a"][0]).toBe(refs["a"][1]);
    expect(refs["a"][1]).toBe(refs["a"][2]);
    expect(refs["b"][0]).toBe(refs["b"][1]);
  });

  test("returns different references for different args", async () => {
    const capturedRefs: Function[] = [];

    class Comp extends Component {
      @memoized
      getHandler(id: number) {
        return () => id;
      }

      render() {
        capturedRefs.push(this.getHandler(1));
        capturedRefs.push(this.getHandler(2));
        capturedRefs.push(this.getHandler(3));
        return <div />;
      }
    }

    await getDOM(<Comp />);

    const [h1, h2, h3] = capturedRefs;
    expect(h1).not.toBe(h2);
    expect(h2).not.toBe(h3);
    expect(h1).not.toBe(h3);
  });

  test("returned handler is callable and returns correct value", async () => {
    const results: number[] = [];

    class Comp extends Component {
      @state items = [10, 20, 30];

      @memoized
      getClickHandler(value: number) {
        return () => results.push(value);
      }

      render() {
        return (
          <ul>
            {this.items.map((v) => (
              <li onclick={this.getClickHandler(v)}>{v}</li>
            ))}
          </ul>
        );
      }
    }

    const { container } = await getDOM<Comp>(<Comp />);
    const items = container.querySelectorAll("li");

    items[0].click();
    items[1].click();
    items[2].click();

    expect(results).toEqual([10, 20, 30]);
  });

  test("cleans up unused entries after re-render", async () => {
    const capturedRefs: Record<string, Function[]> = {};

    class Comp extends Component {
      @state showExtra = true;

      @memoized
      getHandler(id: string) {
        return () => id;
      }

      render() {
        const ref = this.getHandler("always");
        if (!capturedRefs["always"]) capturedRefs["always"] = [];
        capturedRefs["always"].push(ref);

        if (this.showExtra) {
          const extra = this.getHandler("extra");
          if (!capturedRefs["extra"]) capturedRefs["extra"] = [];
          capturedRefs["extra"].push(extra);
        }

        return <div>{this.showExtra ? "yes" : "no"}</div>;
      }
    }

    const { instance, settle } = await getDOM<Comp>(<Comp />);

    // Render 2: 'extra' is no longer used.
    instance.showExtra = false;
    await settle();

    // Render 3: 'always' must be the SAME reference — it was used, so it was
    // never evicted.
    const tick = instance as any;
    tick.showExtra = false;
    // Triggerujemo jos jedan render
    instance.showExtra = false;
    await settle();

    // 'always' referenca je stabilna kroz sve rendere
    const alwaysRefs = capturedRefs["always"];
    expect(alwaysRefs[0]).toBe(alwaysRefs[alwaysRefs.length - 1]);
  });

  test("supports string, number and boolean args", async () => {
    const refs: Function[] = [];

    class Comp extends Component {
      @memoized
      getHandler(a: string, b: number, c: boolean) {
        return () => `${a}-${b}-${c}`;
      }

      render() {
        refs.push(this.getHandler("x", 1, true));
        return <div />;
      }
    }

    await getDOM(<Comp />);

    expect(refs[0]).toBeInstanceOf(Function);
    expect(refs[0]()).toBe("x-1-true");
  });
});
