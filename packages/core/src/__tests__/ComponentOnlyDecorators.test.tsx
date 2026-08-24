import { describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { onDocument, onWindow, ShouldUpdateOnPropsChange, state } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * Three decorators are for components only, and each is refused twice: by the TYPE, and — for a
 * build that has no types — by a THROW naming what to do instead.
 *
 * The throw is not belt and braces. Two of these used to fail in the worst way available:
 * silently ignored; a listener decorator reached a resolver that read a property of `undefined` and
 * died with "Cannot read properties of undefined", an error naming nothing the author wrote.
 *
 * Everything else in the decorator set works on both — see DecoratorReach.test.tsx.
 */

describe("refused at runtime, with a message that says what to do", () => {
  test("@ShouldUpdateOnPropsChange — a hook has no parent-driven prop update to gate", () => {
    // A class decorator, so this lands when the class is DEFINED rather than when
    // something first renders it.
    expect(() => {
      // @ts-expect-error the type refuses it too; this checks the untyped build.
      @ShouldUpdateOnPropsChange(() => true)
      class Gated extends Hook {
        gate() {
          return true;
        }
      }
      return Gated;
    }).toThrow(/@ShouldUpdateOnPropsChange is for components, not hooks/);
  });
});

describe("the neighbours that DO work on a hook", () => {
  test("@onWindow and @onDocument bind to targets a hook can reach", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fired: string[] = [];

    class Global extends Hook {
      @onWindow("resize") onResize() {
        fired.push("window");
      }
      @onDocument("click") onClick() {
        fired.push("document");
      }
    }

    class Owner extends Component {
      @state n = 0;
      h = this.use(Global);
      render() {
        return (
          <div>
            <span>{this.n}</span>
          </div>
        );
      }
    }

    const app = await getDOM<Owner>(<Owner />);
    await app.settle();
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("click"));

    // This is the alternative those messages point at, so it has to be true.
    expect(fired).toEqual(["window", "document"]);
    vi.restoreAllMocks();
  });
});

/**
 * Two `@Host` on one class, refused in words.
 *
 * It always failed — `HOST_META` is written non-configurable, so the second `defineProperty` throws —
 * but with V8's own message: `Cannot redefine property: Symbol(host:meta)`. That names an internal
 * symbol, offers no advice, and points inside `decorators.ts` rather than at the class the author wrote.
 *
 * A throw and not a diagnostic, because there is no correct program: a component is exactly one element,
 * so two answers cannot both be honoured. That is the line between this and `@catchError` (RMD032) or
 * `@ShouldUpdateOnPropsChange` (RMD040), where one declaration quietly wins and the program runs on —
 * wrongly, which is what a code is for.
 */
describe("more than one @Host on one class", () => {
  test("is refused, and says what to do instead", () => {
    expect(() => {
      class Twice extends Component {
        render() {
          return (
            <span>
              <div>
                <i>x</i>
              </div>
            </span>
          );
        }
      }
      return Twice;
    }).toThrow(/<Twice \/> has more than one @Host/);
  });

  test("the message no longer names an internal symbol", () => {
    // The regression this closes. A reader who sees `Symbol(host:meta)` has nothing to search for.
    let message = "";
    try {
      class Twice extends Component {
        render() {
          return (
            <span>
              <div>
                <i>x</i>
              </div>
            </span>
          );
        }
      }
      void Twice;
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toContain("Cannot redefine property");
    expect(message).not.toContain("Symbol(");
    expect(message).toContain("exactly one element");
  });

  /**
   * The half a throw alone cannot do: an app streaming its diagnostics somewhere has to see this one
   * too, or "everything to tidy up" is missing whatever threw. Same two doors as `@ramonda/form`'s
   * `refuse` — the record for the collector, the throw for the developer.
   */
  test("a collector gets a record for it, not just the throw", () => {
    const records: RamondaDiagnostic[] = [];
    globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
    vi.spyOn(console, "log").mockImplementation(() => {});
    resetDiagnostics();

    try {
      expect(() => {
        class Twice extends Component {
          render() {
            return (
              <span>
                <div>
                  <i>x</i>
                </div>
              </span>
            );
          }
        }
        return Twice;
      }).toThrow();

      expect(records.map((record) => record.code)).toEqual(["RMD045"]);
      expect(records[0]!.severity).toBe("error");
      expect(records[0]!.data).toEqual({ component: "Twice" });
      // The advice has to survive into the record, since a panel renders `fix` apart from the message.
      expect(records[0]!.fix).toContain("exactly one element");
    } finally {
      globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
      vi.restoreAllMocks();
    }
  });
});
