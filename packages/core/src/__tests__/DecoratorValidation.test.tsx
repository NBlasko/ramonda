import { describe, test, expect } from "vitest";
import {
  interval,
  timeout,
  onWindow,
  onElement,
  watchProp,
  created,
  Host,
  state,
  persist,
  compute,
  memoized,
} from "../base/decorators";
import { Component } from "../base/Component";

/**
 * Decorator arguments are fixed at the source — they cannot depend on runtime
 * data — so a wrong one is always a mistake, and throwing at class-definition
 * time is the cheapest place to find it.
 */
describe("decorator argument validation", () => {
  test("@interval rejects a non-number delay", () => {
    expect(() => {
      class Bad extends Component {
        // @ts-expect-error — the point of the test is the runtime guard.
        @interval("1000") tick() {}
        render() {
          return <div />;
        }
      }
      return Bad;
    }).toThrow(/\[@interval\].*must be a number of milliseconds.*"1000"/s);
  });

  test("@interval rejects a negative delay", () => {
    expect(() => {
      class Bad extends Component {
        @interval(-5) tick() {}
        render() {
          return <div />;
        }
      }
      return Bad;
    }).toThrow(/must not be negative, got -5/);
  });

  test("@interval rejects NaN", () => {
    expect(() => {
      class Bad extends Component {
        @interval(Number.NaN) tick() {}
        render() {
          return <div />;
        }
      }
      return Bad;
    }).toThrow(/must be a number of milliseconds/);
  });

  test("@timeout accepts a zero delay", () => {
    expect(() => {
      class Fine extends Component {
        @timeout(0) later() {}
        render() {
          return <div />;
        }
      }
      return Fine;
    }).not.toThrow();
  });

  test("@onWindow rejects an empty event type", () => {
    expect(() => {
      class Bad extends Component {
        @onWindow("") handle() {}
        render() {
          return <div />;
        }
      }
      return Bad;
    }).toThrow(/\[@onWindow\].*non-empty string/s);
  });

  test("@onElement rejects a non-string event type", () => {
    expect(() => {
      class Bad extends Component {
        // @ts-expect-error — runtime guard is the point.
        @onElement(42) handle() {}
        render() {
          return <div />;
        }
      }
      return Bad;
    }).toThrow(/non-empty string.*42/s);
  });

  test("@Host rejects an invalid element name", () => {
    expect(() => {
      // @ts-expect-error — the TYPE refuses it first: not a platform tag, and no dash to make it a
      // custom element. This is the second net, for the build that has no types.
      @Host("9div")
      class Bad extends Component {
        render() {
          return <span />;
        }
      }
      return Bad;
    }).toThrow(/not a valid element name/);
  });

  test("@Host rejects an empty tag", () => {
    expect(() => {
      // @ts-expect-error — refused by the type as well; see above.
      @Host("")
      class Bad extends Component {
        render() {
          return <span />;
        }
      }
      return Bad;
    }).toThrow(/non-empty string/);
  });

  test("@Host rejects a plain object where a props callback belongs", () => {
    expect(() => {
      // @ts-expect-error — runtime guard is the point.
      @Host("div", { className: "x" })
      class Bad extends Component {
        render() {
          return <span />;
        }
      }
      return Bad;
    }).toThrow(/must be a callback.*could never react/s);
  });

  test("@Host accepts a valid tag with a props callback", () => {
    expect(() => {
      @Host("my-widget", (self: Fine) => ({ className: self.cls }))
      class Fine extends Component {
        cls = "a";
        render() {
          return <span />;
        }
      }
      return Fine;
    }).not.toThrow();
  });

  test("@watchProp rejects a non-function selector", () => {
    expect(() => {
      class Bad extends Component {
        // @ts-expect-error — runtime guard is the point.
        @watchProp("value") onValue() {}
        render() {
          return <div />;
        }
      }
      return Bad;
    }).toThrow(/\[@watchProp\].*selector function/s);
  });

  test("@created rejects an unknown env", () => {
    expect(() => {
      class Bad extends Component {
        // @ts-expect-error — runtime guard is the point.
        @created({ env: "browser" }) init() {}
        render() {
          return <div />;
        }
      }
      return Bad;
    }).toThrow(/env must be one of "client", "server", "shared".*"browser"/s);
  });

  test("@created accepts each valid env, and the bare form", () => {
    expect(() => {
      class Fine extends Component {
        @created({ env: "client" }) a() {}
        @created({ env: "server" }) b() {}
        @created({ env: "shared" }) c() {}
        @created d() {}
        render() {
          return <div />;
        }
      }
      return Fine;
    }).not.toThrow();
  });

  test("the error names the decorator so it is greppable", () => {
    expect(() => {
      class Bad extends Component {
        @interval(-1) tick() {}
        render() {
          return <div />;
        }
      }
      return Bad;
    }).toThrow(/^\[@interval\]/);
  });
});

/**
 * A decorator put on the wrong KIND of member. TypeScript rejects every case
 * below (each needs a @ts-expect-error), so this guard is for the code that
 * reaches the runtime anyway — plain JS, a suppressed error, a decorator passed
 * around as a value.
 *
 * It matters because three of the four used to be SILENT. Measured before the
 * guard existed, on a component that rendered without complaint:
 *
 * - `@state` on a method  — no error; the method became a signal and its name
 *   was registered as serializable state, which JSON.stringify then dropped.
 * - `@persist` on a method — no error; same missing blob entry, nothing said so.
 * - `@compute` on a field — no error; the field initializer was installed as the
 *   getter body.
 * - `@memoized` on a field — the only one that failed, as
 *   `Cannot read properties of undefined (reading 'get')`, which names neither
 *   the decorator nor the member.
 *
 * Half the decorators already checked the kind; these four did not, and
 * `assertField` had been written but never called.
 */
describe("decorator target validation", () => {
  test("@state rejects a method", () => {
    expect(() => {
      class Bad extends Component {
        // @ts-expect-error — runtime guard is the point.
        @state tick() {}
        render() {
          return <div />;
        }
      }
      return Bad;
    }).toThrow(/\[@state\].*Can only decorate a field.*`tick` is a method/s);
  });

  test("@persist rejects a method", () => {
    expect(() => {
      class Bad extends Component {
        // @ts-expect-error — runtime guard is the point.
        @persist tick() {}
        render() {
          return <div />;
        }
      }
      return Bad;
    }).toThrow(/\[@persist\].*Can only decorate a field/s);
  });

  test("@state accepts a field", () => {
    expect(() => {
      class Fine extends Component {
        @state count = 0;
        render() {
          return <div>{this.count}</div>;
        }
      }
      return Fine;
    }).not.toThrow();
  });

  test("@memoized rejects a field", () => {
    expect(() => {
      class Bad extends Component {
        // @ts-expect-error — runtime guard is the point.
        @memoized value = 1;
        render() {
          return <div />;
        }
      }
      return Bad;
    }).toThrow(/\[@memoized\].*Can only decorate a method.*`value` is a field/s);
  });

  test("@compute rejects a field", () => {
    expect(() => {
      class Bad extends Component {
        // @ts-expect-error — runtime guard is the point.
        @compute value = 1;
        render() {
          return <div />;
        }
      }
      return Bad;
    }).toThrow(/\[@compute\].*Can only decorate a method or a getter.*`value` is a field/s);
  });

  test("@compute accepts both a method and a getter", () => {
    expect(() => {
      class Fine extends Component {
        @state count = 1;
        @compute doubled() {
          return this.count * 2;
        }
        @compute get tripled() {
          return this.count * 3;
        }
        render() {
          return <div />;
        }
      }
      return Fine;
    }).not.toThrow();
  });
});
