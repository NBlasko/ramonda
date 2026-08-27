import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { state, catchError } from "../base/decorators";
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

    class Guard extends Component {
      @state failed = "";

      // Named for what it means here, not for what the framework calls it.
      @catchError whenSomethingBreaks(e: unknown) {
        this.failed = (e as Error).message;
      }

      render() {
        return (
          <div>
            <div>{this.failed ? `caught: ${this.failed}` : <Boom />}</div>
          </div>
        );
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

    class NotAGuard extends Component {
      @state failed = false;

      // Before this was a decorator, defining this would have silently made the
      // component an error boundary.
      catchError() {
        called++;
        this.failed = true;
      }

      render() {
        return (
          <div>
            <div>{this.failed ? "caught" : <Boom />}</div>
          </div>
        );
      }
    }

    class Above extends Component {
      @state failed = false;

      @catchError handle() {
        this.failed = true;
      }

      render() {
        return (
          <div>
            <div>{this.failed ? "outer caught" : <NotAGuard />}</div>
          </div>
        );
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

    class Inner extends Component {
      @catchError decline() {
        return false;
      }
      render() {
        return (
          <div>
            <div>{<Boom />}</div>
          </div>
        );
      }
    }

    class Outer extends Component {
      @state failed = false;
      @catchError handle() {
        this.failed = true;
      }
      render() {
        return (
          <div>
            <div>{this.failed ? "outer caught" : <Inner />}</div>
          </div>
        );
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

    class BaseGuard extends Component {
      @state failed = "";

      @catchError handle(e: unknown) {
        order.push("base");
        this.failed = (e as Error).message;
      }

      render() {
        return (
          <div>
            <div>{this.failed ? `caught:${this.failed}` : <Boom />}</div>
          </div>
        );
      }
    }

    // No decorator: the base declared the role, this only changes what it does —
    // and `super` is why this is a method decorator rather than a class one.
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

  /**
   * Which of the two is in effect, measured — because `RMD032`'s advice names it and the answer is the
   * OPPOSITE of the one for `@ShouldUpdateOnPropsChange` (see `PropsGateInheritance.test.tsx`).
   *
   * One rule underneath both: the last declaration APPLIED wins. `@catchError` is a member decorator,
   * and members initialise top-to-bottom, so the LOWEST is the last to write and the one that gets the
   * error. A class decorator applies bottom-up, so there the highest wins. Same rule, opposite source
   * order, which is why one sentence cannot serve both.
   */
  test("two in ONE class is reported (RMD032), the lower one catches, and a subclass override is not", async () => {
    const ran: string[] = [];

    class Boom extends Component {
      render(): never {
        throw new Error("boom");
      }
    }

    class Twice extends Component {
      @state failed = "";
      @catchError first(e: unknown) {
        ran.push("first");
        this.failed = (e as Error).message;
      }
      @catchError second(e: unknown) {
        ran.push("second");
        this.failed = (e as Error).message;
      }
      render() {
        return (
          <div>
            <div>{this.failed ? "caught" : <Boom />}</div>
          </div>
        );
      }
    }

    const app = await getDOM(<Twice />);
    await app.settle();
    expect(reported("RMD032").length).toBe(1);
    // Only one ran, and it is the one written lower — so the upper handler is dead code.
    expect(ran).toEqual(["second"]);
    expect(app.container.textContent).toContain("caught");

    logged.length = 0;
    resetDiagnostics();

    class Base extends Component {
      @catchError handle() {}
      render() {
        return (
          <div>
            <i>x</i>
          </div>
        );
      }
    }
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
    class Base extends Component {
      @state failed = false;
      @catchError handle() {
        this.failed = true;
      }
      render() {
        return (
          <div>
            <i>{this.failed ? "caught" : "ok"}</i>
          </div>
        );
      }
    }

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

    class Owner extends Component {
      orphan = this.use(Orphan);
      render() {
        return (
          <div>
            <i>x</i>
          </div>
        );
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

    class Guard extends Component {
      @state seen: unknown = undefined;
      @state failed = false;

      @catchError handle(e: unknown) {
        this.seen = e;
        this.failed = true;
      }

      render() {
        return (
          <div>
            <div>{this.failed ? `caught:${String(this.seen)}` : <Boom />}</div>
          </div>
        );
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
