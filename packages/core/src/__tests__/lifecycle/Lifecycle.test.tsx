import { test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { state, effect, mount, create, destroy } from "../../base/decorators";
import { Hook } from "../../base/Hook";
import { Component } from "../../base/Component";

let log: string[] = [];

/**
 * Deeply nested hook to verify multi-level initialization and cleanup
 */
class GrandChildHook extends Hook<{ val: number; label: string }> {
  @create init() {
    log.push(`${this.options.label}:Unit:Init`);
  }

  @destroy dispose() {
    log.push(`${this.options.label}:Unit:Cleanup`);
  }

  @effect onUpdate() {
    log.push(`${this.options.label}:Effect:Value:${this.options.val}`);
    return () => log.push(`${this.options.label}:Effect:Cleanup`);
  }
}

/**
 * Intermediate hook containing a nested GrandChildHook
 */
class ChildHook extends Hook<{ count: number; label: string }> {
  nested = this.use(GrandChildHook, (bag) => ({
    val: bag.options.count * 2,
    label: `${bag.options.label}->Nested`,
  }));

  get getOptions() {
    return this.options;
  }

  @create init() {
    log.push(`${this.options.label}:Unit:Init`);
  }

  @destroy dispose() {
    log.push(`${this.options.label}:Unit:Cleanup`);
  }

  @effect onUpdate() {
    log.push(`${this.options.label}:Effect:Count:${this.options.count}`);
    return () => log.push(`${this.options.label}:Effect:Cleanup`);
  }
}

/**
 * The main component being tested for its complex lifecycle
 */
class LifecycleTester extends Component<{ trigger: number }> {
  @state local = 0;

  hookA = this.use(ChildHook, (bag) => ({
    count: bag.props.trigger + bag.local,
    label: "HookA",
  }));

  hookB = this.use(GrandChildHook, () => ({
    val: this.hookA.getOptions.count + 100,
    label: "HookB",
  }));

  @create init() {
    log.push("Component:Unit:Init");
  }

  @destroy dispose() {
    log.push("Component:Unit:Cleanup");
  }

  @mount mounted() {
    log.push("Component:Mount");
  }

  render() {
    log.push("Component:Render");
    return <div data-testid="target">{this.props.trigger}</div>;
  }
}

/**
 * RootWrapper controls the lifecycle of LifecycleTester without manual util calls
 */
class RootWrapper extends Component {
  @state show = true;
  @state trigger = 1;

  render() {
    return <div id="root">{this.show ? <LifecycleTester trigger={this.trigger} /> : <h1>Cleaned Up</h1>}</div>;
  }
}

test("Complex Lifecycle: Pure Declarative Hierarchy & Unmounting", async () => {
  log = [];

  // 1. INITIAL MOUNT PHASE
  const { instance, settle } = await getDOM<RootWrapper>(<RootWrapper />);

  /**
   * Order Rationale:
   * Units are initialized top-down following the class definition order.
   * Effects/Mount run after the DOM is ready.
   */
  expect(log).toEqual([
    "Component:Unit:Init",
    "HookA:Unit:Init",
    "HookA->Nested:Unit:Init",
    "HookB:Unit:Init",
    "Component:Render",
    "Component:Mount",
    "HookA:Effect:Count:1",
    "HookA->Nested:Effect:Value:2",
    "HookB:Effect:Value:101",
  ]);

  log = [];

  // 2. BATCHING & INTER-HOOK PROPAGATION
  // We find the child instance via the Root or simply trigger a prop change from Root
  instance.trigger = 30; // Changing trigger from parent
  await settle();

  const renders = log.filter((l) => l === "Component:Render");
  // Batching ensures only one render happens for the child
  expect(renders.length).toBe(1);

  // Final values: trigger(30) + local(0) = 30.
  expect(log).toContain("HookA:Effect:Count:30");
  expect(log).toContain("HookB:Effect:Value:130");

  log = [];

  // 3. PURE DECLARATIVE UNMOUNTING
  // Instead of calling lifecycleCleanupManagement, we remove the component via state
  instance.show = false;
  await settle();

  const cleanups = log.filter((l) => l.includes("Cleanup"));

  /**
   * LIFO (Last-In-First-Out) Verification:
   * The framework must detect removal and clean up in reverse order of creation.
   * Effect cleanups run first (reverse), then the unified @destroy pass (reverse) —
   * @destroy is now the single cleanup for both @create and @mount.
   * Child components and their effects must be disposed of before parent resources.
   */
  expect(cleanups).toEqual([
    "HookB:Effect:Cleanup",
    "HookA->Nested:Effect:Cleanup",
    "HookA:Effect:Cleanup",
    "HookB:Unit:Cleanup",
    "HookA->Nested:Unit:Cleanup",
    "HookA:Unit:Cleanup",
    "Component:Unit:Cleanup",
  ]);

  // Verify DOM state
  expect(document.getElementById("root")?.innerHTML).toContain("Cleaned Up");
});
