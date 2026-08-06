import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Host, state, catchError } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * Catching an error is now declared, not named.
 *
 * It used to be a RESERVED METHOD NAME: `errorHandler` walked the parent chain
 * and called `component.catchError` on whichever ancestor had one. So a component
 * that defined a method called `catchError` for its own reasons silently became
 * an error boundary and swallowed its subtree's failures — the exact footgun the
 * framework removes everywhere else with a decorator, and the reason
 * `@deferHydration`, `@ShouldUpdateOnPropsChange` and `@StableProps` all exist in
 * the form they do ("a framework that reserves a name on every class changes
 * behaviour silently").
 *
 * The method is yours to name now, and the capability is opt-in by intent.
 */
describe("@catchError", () => {
  const logged: string[] = [];

  beforeEach(() => {
    logged.length = 0;
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const reported = (code: string) => logged.filter((line) => line.includes(code));

  test("catches a failure below it, under any method name", async () => {
    class Boom extends Component {
      render(): never {
        throw new Error("boom");
      }
    }

    @Host("div")
    class Guard extends Component {
      @state failed = "";

      // Named for what it means here, not for what the framework calls it.
      @catchError whenSomethingBreaks(e: unknown) {
        this.failed = (e as Error).message;
      }

      render() {
        return <div>{this.failed ? `caught: ${this.failed}` : <Boom />}</div>;
      }
    }

    const app = await getDOM(<Guard />);
    await app.settle();

    expect(app.container.textContent).toContain("caught: boom");
  });

  test("a plain method called catchError has no framework meaning", async () => {
    let called = 0;

    class Boom extends Component {
      render(): never {
        throw new Error("boom");
      }
    }

    @Host("div")
    class NotAGuard extends Component {
      @state failed = false;

      // Before this was a decorator, defining this would have silently made the
      // component an error boundary.
      catchError() {
        called++;
        this.failed = true;
      }

      render() {
        return <div>{this.failed ? "caught" : <Boom />}</div>;
      }
    }

    @Host("div")
    class Above extends Component {
      @state failed = false;

      @catchError handle() {
        this.failed = true;
      }

      render() {
        return <div>{this.failed ? "outer caught" : <NotAGuard />}</div>;
      }
    }

    const app = await getDOM(<Above />);
    await app.settle();

    expect(called).toBe(0);
    expect(app.container.textContent).toContain("outer caught");
  });

  test("returning false declines and the error travels on", async () => {
    class Boom extends Component {
      render(): never {
        throw new Error("boom");
      }
    }

    @Host("div")
    class Inner extends Component {
      @catchError decline() {
        return false;
      }
      render() {
        return <div>{<Boom />}</div>;
      }
    }

    @Host("div")
    class Outer extends Component {
      @state failed = false;
      @catchError handle() {
        this.failed = true;
      }
      render() {
        return <div>{this.failed ? "outer caught" : <Inner />}</div>;
      }
    }

    const app = await getDOM(<Outer />);
    await app.settle();

    expect(app.container.textContent).toContain("outer caught");
  });

  test("a subclass inherits the handler, and overriding the method wins", async () => {
    const order: string[] = [];

    class Boom extends Component {
      render(): never {
        throw new Error("boom");
      }
    }

    @Host("div")
    class BaseGuard extends Component {
      @state failed = "";

      @catchError handle(e: unknown) {
        order.push("base");
        this.failed = (e as Error).message;
      }

      render() {
        return <div>{this.failed ? `caught:${this.failed}` : <Boom />}</div>;
      }
    }

    // No decorator: the base declared the role, this only changes what it does —
    // and `super` is why this is a method decorator rather than a class one.
    @Host("div")
    class SubGuard extends BaseGuard {
      override handle(e: unknown) {
        order.push("sub");
        super.handle(e);
      }
    }

    const app = await getDOM(<SubGuard />);
    await app.settle();

    expect(order).toEqual(["sub", "base"]);
    expect(app.container.textContent).toContain("caught:boom");
  });

  test("two in ONE class is reported (RMD032); a subclass override is not", async () => {
    @Host("div")
    class Twice extends Component {
      @catchError first() {}
      @catchError second() {}
      render() {
        return <i>x</i>;
      }
    }

    const app = await getDOM(<Twice />);
    await app.settle();
    expect(reported("RMD032").length).toBe(1);

    logged.length = 0;
    resetDiagnostics();

    @Host("div")
    class Base extends Component {
      @catchError handle() {}
      render() {
        return <i>x</i>;
      }
    }
    @Host("div")
    class Sub extends Base {
      @catchError ownHandle() {}
    }

    const app2 = await getDOM(<Sub />);
    await app2.settle();
    expect(reported("RMD032")).toEqual([]);
  });
});
