import { test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { state, created, destroyed } from "../../base/decorators";
import { Hook } from "../../base/Hook";
import { Component } from "../../base/Component";
import { effectLike } from "../../test/effectLike";

let log: string[] = [];

/**
 * Hook with internal state that will be consumed by another hook
 */
class ProducerHook extends Hook<{ label: string }> {
  @state internalCount = 0; // Internal state of Hook A

  @created init() {
    log.push(`${this.props.label}:Unit:Init`);
  }

  @destroyed dispose() {
    log.push(`${this.props.label}:Unit:Cleanup`);
  }
}

/**
 * Consumer hook that will receive data from ProducerHook
 */
class ConsumerHook extends Hook<{ val: number; label: string }> {
  @effectLike() onUpdate() {
    log.push(`${this.props.label}:Effect:Value:${this.props.val}`);
    return () => log.push(`${this.props.label}:Effect:Cleanup`);
  }
}

class CrossHookTester extends Component {
  // Hook A produces data
  hookA = this.use(ProducerHook, () => ({ label: "Producer" }));

  // Hook B consumes data directly from Hook A's instance
  // This tests if the reactivity system tracks dependencies across hook instances
  hookB = this.use(ConsumerHook, () => ({
    val: this.hookA.internalCount,
    label: "Consumer",
  }));

  render() {
    log.push("Component:Render");
    return <div>{this.hookA.internalCount}</div>;
  }
}

test("Cross-Hook Reactivity: HookB reacting to HookA internal state", async () => {
  log = [];
  const { instance, settle } = await getDOM<CrossHookTester>(<CrossHookTester />);

  // Initial logs
  expect(log).toContain("Producer:Unit:Init");
  expect(log).toContain("Consumer:Effect:Value:0");

  log = [];

  // TRIGGER: Change state inside Hook A
  instance.hookA.internalCount = 99;

  // Wait for batching
  await settle();

  /**
   * Expectations:
   * 1. Changing instance.hookA.internalCount should trigger reBuild via Proxy/Setter.
   * 2. Consumer (HookB) should re-evaluate its options.
   * 3. Only ONE render should occur.
   */
  const renders = log.filter((l) => l === "Component:Render");
  expect(renders.length).toBe(1);

  // Verify that Consumer received the update from Producer
  expect(log).toContain("Consumer:Effect:Value:99");
});
