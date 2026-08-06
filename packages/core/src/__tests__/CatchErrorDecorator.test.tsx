import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Host, state, catchError } from "../base/decorators";
import { Hook } from "../base/Hook";
import { ErrorBoundary } from "../base/ErrorBoundary";
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

  test("a subclass that overrides the method AND re-decorates it is not a duplicate", async () => {
    // The most natural way to specialise a role: keep the name, declare it again.
    // A duplicate check that looked the method up by NAME saw the subclass's
    // prototype for BOTH declarations and reported this — advice to delete a line
    // that is doing exactly what it should. The owner is found by the decorated
    // FUNCTION's identity instead, which is the only thing that separates them.
    @Host("div")
    class Base extends Component {
      @state failed = false;
      @catchError handle() {
        this.failed = true;
      }
      render() {
        return <i>{this.failed ? "caught" : "ok"}</i>;
      }
    }

    @Host("div")
    class Sub extends Base {
      @catchError override handle() {
        this.failed = true;
      }
    }

    const app = await getDOM(<Sub />);
    await app.settle();

    expect(reported("RMD032")).toEqual([]);
  });

  test("throws when placed on a hook — a hook is not on the error path", async () => {
    class Orphan extends Hook {
      // @ts-expect-error TypeScript refuses it first: the decorator's `This` requires a
      // COMPONENT_RUNTIME, which a Hook does not have. The throw below is what an untyped
      // build gets, and is what this test is about.
      @catchError never() {}
    }

    @Host("div")
    class Owner extends Component {
      orphan = this.use(Orphan);
      render() {
        return <i>x</i>;
      }
    }

    // At FIRST INSTANCE, not at class definition: a method decorator registers
    // from `addInitializer`, which runs per instance. `@ShouldUpdateOnPropsChange`
    // reports the same class of mistake when the CLASS is defined, because it is a
    // class decorator — the difference is inherent to the two kinds, and worth
    // knowing rather than being surprised by.
    await expect(getDOM(<Owner />)).rejects.toThrow(/@catchError is for components, not hooks/);
  });

  test("a thrown non-Error is still handled", async () => {
    class Boom extends Component {
      render(): never {
        // eslint-disable-next-line no-throw-literal
        throw "just a string";
      }
    }

    @Host("div")
    class Guard extends Component {
      @state seen: unknown = undefined;
      @state failed = false;

      @catchError handle(e: unknown) {
        this.seen = e;
        this.failed = true;
      }

      render() {
        return <div>{this.failed ? `caught:${String(this.seen)}` : <Boom />}</div>;
      }
    }

    const app = await getDOM(<Guard />);
    await app.settle();

    // Handled, not rethrown: the walk stops at anything that is not `false`.
    expect(app.container.textContent).toContain("caught:just a string");
  });
});

/**
 * `ErrorBoundary`'s own handler is now a decorated method called `handleFailure`,
 * not the reserved name — so extending the boundary means overriding THAT.
 *
 * Worth its own tests because extending is how behaviour is reused here, and a
 * specialised boundary — one that reports and then does what the base did — is
 * the case the method form was chosen for.
 */
describe("extending ErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("a subclass can report and still fall back, through super", async () => {
    const reported: string[] = [];

    class ReportingBoundary extends ErrorBoundary {
      override handleFailure(e: unknown) {
        reported.push((e as Error).message);
        return super.handleFailure(e);
      }
    }

    class Boom extends Component {
      render(): never {
        throw new Error("kaboom");
      }
    }

    const app = await getDOM(
      <ReportingBoundary fallback={({ message }) => <p>caught: {message}</p>}>
        <Boom />
      </ReportingBoundary>,
    );
    await app.settle();

    expect(reported).toEqual(["kaboom"]);
    expect(app.container.textContent).toContain("caught: kaboom");
  });

  test("a subclass that declines sends the error to the boundary above", async () => {
    class NeverCatches extends ErrorBoundary {
      override handleFailure() {
        return false;
      }
    }

    class Boom extends Component {
      render(): never {
        throw new Error("kaboom");
      }
    }

    const app = await getDOM(
      <ErrorBoundary fallback={({ message }) => <p>outer: {message}</p>}>
        <NeverCatches fallback={() => <p>inner</p>}>
          <Boom />
        </NeverCatches>
      </ErrorBoundary>,
    );
    await app.settle();

    expect(app.container.textContent).toContain("outer: kaboom");
    expect(app.container.textContent).not.toContain("inner");
  });
});
