import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM, findAll } from "../test/setup";
import { Component, state, memoized, persist, created, mounted, destroyed } from "../index";

/**
 * The decorator surface is the biggest thing this framework exposes, and it read
 * as 65% branch coverage — most of which turned out to be the `false` side of
 * `if (__DEV__)`, unreachable while tests run in DEV. These cover what was
 * genuinely untested: memoized's identity and collection, @persist's
 * non-reactive write, symbol-named members, and the lifecycle FACTORY form.
 *
 * Nothing was found broken.
 */
describe("decorators", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("memoized returns one function per distinct argument list", async () => {
    let built = 0;
    class C extends Component {
      @state tick = 0;
      @memoized pick(id: number) {
        built++;
        return () => id;
      }
      render() {
        return (
          <div>
            <span>{this.tick}</span>
          </div>
        );
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    const a1 = app.instance.pick(1);
    const a2 = app.instance.pick(1);
    const b = app.instance.pick(2);
    // The point of it: a stable handler identity, so passing it as a prop or an
    // onClick does not look like a change on every render.
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(built).toBe(2);
    // The key carries the type, so 1 and "1" are not the same handler.
    expect(app.instance.pick("1" as never)).not.toBe(a1);
  });

  test("a non-primitive argument is refused, loudly — in DEVELOPMENT", async () => {
    class C extends Component {
      @memoized pick(o: unknown) {
        return () => o;
      }
      render() {
        return (
          <div>
            <span>x</span>
          </div>
        );
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    // Objects would have to be stringified to build a key, and two different
    // objects would collide into one entry — the wrong handler, silently.
    //
    // Loudly HERE and not in production, where this used to throw out of a render
    // and take the page down over one argument. See `prod/MemoizedKey.prod.test.tsx`
    // for the other half, and `MemoizedKey.test.tsx` for what the message says.
    expect(() => app.instance.pick({ a: 1 })).toThrow(/@memoized on C\.pick/);
  });

  test("two instances of a component do not share handlers", async () => {
    class Child extends Component<{ id: string }> {
      @memoized pick(n: number) {
        return () => `${this.props.id}:${n}`;
      }
      render() {
        return (
          <div>
            <span>{this.props.id}</span>
          </div>
        );
      }
    }
    class App extends Component {
      render() {
        return (
          <div>
            <div>
              <Child id="a" />
              <Child id="b" />
            </div>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    const [ca, cb] = findAll<any>(app.container, "Child");
    expect(ca.pick(1)).not.toBe(cb.pick(1));
    expect(`${ca.pick(1)()}/${cb.pick(1)()}`).toBe("a:1/b:1");
  });

  test("a handler for an item that stopped rendering is collected", async () => {
    class C extends Component {
      @state ids = [1, 2, 3];
      @memoized pick(id: number) {
        return () => id;
      }
      render() {
        return (
          <div>
            <ul>
              {this.ids.map((i) => (
                <li onclick={this.pick(i)}>{i}</li>
              ))}
            </ul>
          </div>
        );
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    // Read the handler off the DOM — calling pick(3) here would mark it used
    // and rescue it from the very cleanup being tested.
    const lis = Array.from(app.container.querySelectorAll("li")) as any[];
    const first = lis[2]._listeners?.onclick;
    expect(typeof first).toBe("function");

    app.instance.ids = [1, 2];
    await app.settle();

    // Collected, so the map cannot grow forever on a long-lived component.
    expect(app.instance.pick(3)).not.toBe(first);
    // And the ones still on screen keep their identity.
    expect(app.instance.pick(1)).toBe(lis[0]._listeners?.onclick);
  });

  test("@persist holds a value without making it reactive", async () => {
    class C extends Component {
      @persist createdAt = "t0";
      @state tick = 0;
      render() {
        return (
          <div>
            <span>
              {this.createdAt}-{this.tick}
            </span>
          </div>
        );
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    app.instance.createdAt = "t1";
    // No signal, so writing it schedules nothing.
    expect(app.container.textContent).toBe("t0-0");
    app.instance.tick = 1;
    await app.settle();
    expect(app.container.textContent).toBe("t1-1");
  });

  test("a symbol-named member is refused", async () => {
    const sym = Symbol("hidden");
    class C extends Component {
      @state [sym] = 1;
      render() {
        return (
          <div>
            <span>x</span>
          </div>
        );
      }
    }

    // The decorator accepts the declaration; the name is checked when an
    // instance is built, which is the first moment the field actually exists.
    await expect(getDOM<C>(<C />)).rejects.toThrow("[state] Symbols are not supported.");
  });

  test("the lifecycle factory form honours env", async () => {
    const ran: string[] = [];
    class C extends Component {
      @created({ env: "client" }) onlyClient() {
        ran.push("create:client");
      }
      @created({ env: "server" }) onlyServer() {
        ran.push("create:server");
      }
      @mounted({ env: "client" }) mountedClient() {
        ran.push("mount:client");
      }
      @destroyed({ env: "client" }) goneClient() {
        ran.push("destroy:client");
      }
      // The other side of the same question, and the one nothing asked: a teardown declared for the
      // SERVER must stay quiet in a browser. Its branch in `runDestroyLifecycle` was the only
      // unhit one left in that file.
      @destroyed({ env: "server" }) goneServer() {
        ran.push("destroy:server");
      }
      render() {
        return (
          <div>
            <span>x</span>
          </div>
        );
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    // `@created({ env: "server" })` must not run in a browser.
    expect(ran).toEqual(["create:client", "mount:client"]);

    app.unmount();
    expect(ran).toContain("destroy:client");
    expect(ran).not.toContain("destroy:server");
    // Named as the whole list, so a teardown appearing from anywhere else fails here too.
    expect(ran).toEqual(["create:client", "mount:client", "destroy:client"]);
  });

  test("an unknown env is refused", async () => {
    expect(() => {
      class C extends Component {
        @created({ env: "nowhere" as never }) bad() {}
        render() {
          return (
            <div>
              <span>x</span>
            </div>
          );
        }
      }
      void C;
    }).toThrow(/env must be/);
  });
});
