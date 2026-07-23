import { test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { state, effect, create, destroy } from "../../base/decorators";
import { Hook } from "../../base/Hook";
import { Component } from "../../base/Component";

let log: string[] = [];

/**
 * Hook to track async operations and cleanups with labels
 */
class AsyncHook extends Hook<{ userId: number; label: string }> {
  @state data: string | null = null;

  @create init() {
    log.push(`${this.options.label}:Unit:Init`);
  }

  @destroy dispose() {
    log.push(`${this.options.label}:Unit:Cleanup`);
  }

  @effect onUpdate() {
    const id = this.options.userId;
    log.push(`${this.options.label}:Effect:Start:User:${id}`);

    const timeoutId = setTimeout(() => {
      this.data = `Data for ${id}`;
      log.push(`${this.options.label}:Effect:Success:User:${id}`);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      log.push(`${this.options.label}:Effect:Cleanup:User:${id}`);
    };
  }
}

/**
 * Child component that uses the async hook
 */
class AsyncChild extends Component<{ userId: number }> {
  userHook = this.use(AsyncHook, (bag) => ({
    userId: bag.props.userId,
    label: "ChildHook",
  }));

  render() {
    log.push(`Child:Render:User:${this.props.userId}`);
    return <div id="child">User: {this.props.userId}</div>;
  }
}

/**
 * Intermediate parent to test prop updates
 */
class ParentWrapper extends Component<{ userId: number }> {
  @create init() {
    log.push("Parent:Unit:Init");
  }

  @destroy dispose() {
    log.push("Parent:Unit:Cleanup");
  }

  render() {
    log.push(`Parent:Render:User:${this.props.userId}`);
    return (
      <div id="parent">
        <AsyncChild userId={this.props.userId} />
      </div>
    );
  }
}

/**
 * Root component to test the total destruction of the hierarchy
 */
class RootWrapper extends Component {
  @state userId = 1;
  @state showParent = true;

  render() {
    log.push("Root:Render");
    return <div id="root">{this.showParent ? <ParentWrapper userId={this.userId} /> : <h1>App Terminated</h1>}</div>;
  }
}

test("Pure Declarative Stress Test: Recursive Unmounting via Diffing", async () => {
  log = [];

  // 1. INITIAL MOUNT
  // We mount the Root, which triggers the entire chain: Parent -> Child -> Hook
  const { instance, settle } = await getDOM<RootWrapper>(<RootWrapper />);

  expect(log).toContain("Parent:Unit:Init");
  expect(log).toContain("ChildHook:Unit:Init");
  expect(log).toContain("ChildHook:Effect:Start:User:1");

  log = [];

  // 2. UPDATE PROPS VIA ROOT (User 1 -> User 2)
  // Changing Root state triggers Parent re-render (via props) and Child re-render
  instance.userId = 2;
  await settle();

  // Verify that the effect cleanup for User 1 happened before starting User 2
  expect(log).toContain("ChildHook:Effect:Cleanup:User:1");
  expect(log).toContain("ChildHook:Effect:Start:User:2");

  // Wait for the async success of User 2 to ensure state is stable
  await new Promise((r) => setTimeout(r, 150));
  expect(log).toContain("ChildHook:Effect:Success:User:2");

  log = [];

  // 3. TOTAL DESTRUCTION VIA ROOT STATE
  // Setting showParent to false will cause diffAndMerge to remove the ParentWrapper node.
  // This must trigger the recursive unmount: Parent -> Child -> Hook Cleanup.
  instance.showParent = false;
  await settle();

  /**
   * RECURSIVE CLEANUP CHECK:
   * Even though we only changed a state in Root, the framework must:
   * 1. Detect ParentWrapper is removed.
   * 2. Cleanup ParentWrapper (Unit cleanup).
   * 3. Detect AsyncChild is inside the removed branch.
   * 4. Cleanup AsyncChild (Hook Unit & Effect cleanups).
   */
  expect(log).toContain("ChildHook:Effect:Cleanup:User:2");
  expect(log).toContain("ChildHook:Unit:Cleanup");
  expect(log).toContain("Parent:Unit:Cleanup");

  // Ensure the DOM actually changed
  const rootElement = document.getElementById("root");
  expect(rootElement?.innerHTML).toContain("App Terminated");
});
