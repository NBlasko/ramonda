import { afterEach, describe, expect, test } from "vitest";
import { Component, Hook, bootstrap, created, mounted, state, unmount } from "../index";
import { flushSync } from "../testing";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";

/**
 * A hook is made while its owner is made, and at no other time (RMD063).
 *
 * Every `use()` then runs once, in the same order, for every instance of the owner — the update walk,
 * the hook tree hydration restores state into, and what `@ramonda/check` proves about a class rest on
 * that. Construction ends where the framework's `new` returns, and there are three of those: a
 * component the diff builds, one hydration adopts, and a hook `use()` makes. Each is refused here.
 */

class Counter extends Hook<{ start: number }> {
  @state n = 0;
}

const containers: HTMLElement[] = [];

function container(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  containers.push(element);
  return element;
}

afterEach(() => {
  for (const element of containers.splice(0)) {
    unmount(element);
    element.remove();
  }
});

describe("a hook made with its owner", () => {
  test("as a field, of a component and of a hook, is made", () => {
    class Inner extends Hook {
      counter = this.use(Counter, () => ({ start: 2 }));
    }
    let page: Page | undefined;
    class Page extends Component {
      counter = this.use(Counter, () => ({ start: 1 }));
      inner = this.use(Inner);
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        page = this;
      }
      render() {
        return <p>{this.counter.n}</p>;
      }
    }
    bootstrap(<Page />, container());
    flushSync();
    expect(page!.counter).toBeInstanceOf(Counter);
    expect(page!.inner.counter).toBeInstanceOf(Counter);
  });

  test("from a component's method, once the diff has built it, is refused", () => {
    let page: Page | undefined;
    class Page extends Component {
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        page = this;
      }
      open(): void {
        this.use(Counter, () => ({ start: 1 }));
      }
      render() {
        return <p />;
      }
    }
    bootstrap(<Page />, container());
    flushSync();
    expect(() => page!.open()).toThrow(/RMD063.*Page uses Counter after it was constructed/);
  });

  test("from @created and from @mounted, is refused", () => {
    class MadeInCreated extends Component {
      @created made(): void {
        this.use(Counter, () => ({ start: 1 }));
      }
      render() {
        return <p />;
      }
    }
    class MadeInMounted extends Component {
      @mounted made(): void {
        this.use(Counter, () => ({ start: 1 }));
      }
      render() {
        return <p />;
      }
    }
    expect(() => bootstrap(<MadeInCreated />, container())).toThrow(/RMD063/);
    expect(() => bootstrap(<MadeInMounted />, container())).toThrow(/RMD063/);
  });

  test("from a hook's method, once use() has made the hook, is refused", () => {
    class Grows extends Hook {
      grow(): void {
        this.use(Counter, () => ({ start: 1 }));
      }
    }
    let page: Page | undefined;
    class Page extends Component {
      grows = this.use(Grows);
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        page = this;
      }
      render() {
        return <p />;
      }
    }
    bootstrap(<Page />, container());
    flushSync();
    expect(() => page!.grows.grow()).toThrow(/RMD063.*Grows uses Counter/);
  });

  test("from a method of a component hydration adopted, is refused", async () => {
    const adopted: Page[] = [];
    class Page extends Component {
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        adopted.push(this);
      }
      open(): void {
        this.use(Counter, () => ({ start: 1 }));
      }
      render() {
        return <p>page</p>;
      }
    }
    const element = container();
    element.innerHTML = await renderToString(<Page />);
    adopted.length = 0;
    hydrateRoot(<Page />, element);
    flushSync();

    expect(adopted).toHaveLength(1);
    expect(element.textContent).toBe("page");
    expect(() => adopted[0].open()).toThrow(/RMD063/);
  });

  test("in a base's fields and a subclass's, and after super() in a constructor, is made", () => {
    class Base extends Component {
      first = this.use(Counter, () => ({ start: 1 }));
      render() {
        return <p>{this.first.n}</p>;
      }
    }
    let derived: Derived | undefined;
    class Derived extends Base {
      second = this.use(Counter, () => ({ start: 2 }));
      third: Counter;
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        // Still constructing: the mark is set once the most-derived constructor has returned.
        this.third = this.use(Counter, () => ({ start: 3 }));
        derived = this;
      }
    }
    bootstrap(<Derived />, container());
    flushSync();
    expect([derived!.first, derived!.second, derived!.third].every((one) => one instanceof Counter)).toBe(true);
  });

  test("on the server, from @created, is refused; in a field it renders", async () => {
    class Served extends Component {
      counter = this.use(Counter, () => ({ start: 1 }));
      render() {
        return <p>{this.counter.n}</p>;
      }
    }
    class Late extends Component {
      @created made(): void {
        this.use(Counter, () => ({ start: 1 }));
      }
      render() {
        return <p />;
      }
    }
    expect(await renderToString(<Served />)).toContain("0");
    await expect(renderToString(<Late />)).rejects.toThrow(/RMD063/);
  });

  /**
   * A component the server did not render is BUILT by hydration rather than adopted — through the diff's
   * path, which marks it like any other.
   */
  test("from a method of a component hydration built because the server had not rendered it, is refused", async () => {
    const built: Extra[] = [];
    class Extra extends Component {
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        built.push(this);
      }
      open(): void {
        this.use(Counter, () => ({ start: 1 }));
      }
      render() {
        return <b>extra</b>;
      }
    }
    class Page extends Component<{ withExtra: boolean }> {
      render() {
        return <div>{this.props.withExtra ? <Extra /> : null}</div>;
      }
    }
    const element = container();
    element.innerHTML = await renderToString(<Page withExtra={false} />);
    hydrateRoot(<Page withExtra={true} />, element);
    flushSync();

    expect(built).toHaveLength(1);
    expect(element.textContent).toBe("extra");
    expect(() => built[0].open()).toThrow(/RMD063/);
  });
});
