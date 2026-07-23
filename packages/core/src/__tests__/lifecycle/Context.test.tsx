import { describe, test, expect, beforeEach } from "vitest";
import { state } from "../../base/decorators";
import { Component } from "../../base/Component";
import { createContext } from "../../base/Context";
import { getDOM } from "../../test/setup";

describe("Context API: Hierarchy and Performance", () => {
  let log: string[] = [];

  // Defined outside the tests to verify stability across instances.
  const [ThemeProvider, ThemeContext] = createContext({ color: "default" });

  beforeEach(() => {
    log = [];
  });

  /**
   * TEST 1: Propagation + render skipping (performance).
   */
  test("should propagate updates and skip pure components", async () => {
    class ThemeDisplay extends Component {
      theme = this.use(ThemeContext);
      render() {
        log.push(`Render:Display:${this.theme.color}`);
        return <div id="display-1">{this.theme.color}</div>;
      }
    }

    class PureMiddle extends Component {
      render() {
        log.push("Render:Middle");
        return <ThemeDisplay />;
      }
    }

    class ContextApp extends Component {
      @state currentColor = "blue";
      // Provide via hook; ContextApp and its descendants can read the value.
      theme = this.use(ThemeProvider, () => ({ color: this.currentColor }));

      render() {
        log.push("Render:Root");
        return <PureMiddle />;
      }
    }

    using app = await getDOM<ContextApp>(<ContextApp />);
    const { instance, settle } = app;

    expect(log).toContain("Render:Root");
    expect(log).toContain("Render:Middle");
    expect(log).toContain("Render:Display:blue");

    log = [];
    // Action: change the color at the root.
    instance.currentColor = "red";
    await settle();

    expect(log).toContain("Render:Root");
    expect(log).not.toContain("Render:Middle"); // Pure component is not re-rendered
    expect(log).toContain("Render:Display:red");

    const display = document.getElementById("display-1");
    expect(display?.textContent).toBe("red");
  });

  /**
   * TEST 2: Nested scoping (shadowing).
   * The inner provider must override the outer one for its descendants.
   */
  test("should correctly resolve nested scoping", async () => {
    class NestedDisplay extends Component {
      theme = this.use(ThemeContext);
      render() {
        log.push(`Render:Nested:${this.theme.color}`);
        return <div id="display-nested">{this.theme.color}</div>;
      }
    }

    class InnerScope extends Component {
      theme = this.use(ThemeProvider, () => ({ color: "inner" }));
      render() {
        return <NestedDisplay />;
      }
    }

    class OuterScope extends Component {
      theme = this.use(ThemeProvider, () => ({ color: "outer" }));
      render() {
        return <InnerScope />;
      }
    }

    using app = await getDOM(<OuterScope />);
    await app.settle();

    const display = document.getElementById("display-nested");

    // Must resolve to "inner" (nearest provider wins), not "outer".
    expect(display?.textContent).toBe("inner");
  });

  /**
   * TEST 3: Isolation with a completely fresh context instance.
   */
  test("should work with fresh context instances", async () => {
    const [FreshProvider, FreshContext] = createContext({ val: "init" });

    class FreshDisplay extends Component {
      ctx = this.use(FreshContext);
      render() {
        return <div id="display-fresh">{this.ctx.val}</div>;
      }
    }

    class FreshApp extends Component {
      ctx = this.use(FreshProvider, () => ({ val: "new-value" }));
      render() {
        return <FreshDisplay />;
      }
    }

    using app = await getDOM(<FreshApp />);
    await app.settle();

    const display = document.getElementById("display-fresh");
    expect(display?.textContent).toBe("new-value");
  });
});

describe("Lifecycle: Cleanup & Memory Management", () => {
  let log: string[] = [];
  const [UserProvider, UserContext] = createContext({ name: "Guest" });

  class Profile extends Component {
    user = this.use(UserContext);

    render() {
      log.push(`Render:Profile:${this.user.name}`);
      return <div>{this.user.name}</div>;
    }
  }

  class ParentApp extends Component {
    @state showProfile = true;
    @state userName = "Alice";
    user = this.use(UserProvider, () => ({ name: this.userName }));

    render() {
      return this.showProfile ? <Profile /> : <div>Profile Hidden</div>;
    }
  }

  beforeEach(() => {
    log = [];
  });

  test("should detach consumer from context when unmounted", async () => {
    using app = await getDOM<ParentApp>(<ParentApp />);
    const { settle, instance } = app;

    await settle();

    expect(log).toContain("Render:Profile:Alice");
    log = [];

    // 1. UNMOUNT: hide the Profile component.
    instance.showProfile = false;
    await settle();

    expect(log).not.toContain("Render:Profile:Alice");
    log = [];

    // 2. ACTION: change the context data while Profile is unmounted.
    // If cleanup does not work, this would try to re-render the (gone) Profile.
    instance.userName = "Bob";
    await settle();

    /**
     * EXPECTATION: no Render:Profile — a detached consumer must not react
     * (otherwise we have a "zombie component" still listening to context).
     */
    const profileRenders = log.filter((l) => l.startsWith("Render:Profile"));
    expect(profileRenders).toHaveLength(0);
  });
});
