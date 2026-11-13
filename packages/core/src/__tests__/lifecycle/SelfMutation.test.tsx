import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { state } from "../../base/decorators";
import { Component } from "../../base/Component";
import { effectLike } from "../../test/effectLike";

let log: string[] = [];

/**
 * Component to test mutation protection.
 */
class MutationGuardComponent extends Component {
  @state count = 0;

  @effectLike() onCountChange() {
    log.push(`Effect:Run:Count:${this.count}`);

    if (this.count < 5) {
      log.push(`Action:Attempting:Increment:${this.count + 1}`);
      this.count++;
    }
  }

  render() {
    log.push(`Render:Count:${this.count}`);
    return <div>{this.count}</div>;
  }
}

describe("Lifecycle: Self-Mutation Protection", () => {
  test("should allow one mutation but detach the signal to prevent loops", async () => {
    log = [];

    const { instance, settle } = await getDOM<MutationGuardComponent>(<MutationGuardComponent />);
    await settle();

    /**
     * BEHAVIOR ANALYSIS:
     * 1. Initial run: count is 0. Effect runs.
     * 2. Effect mutates count to 1.
     * 3. Framework detects mutation and detaches 'count' from this effect's deps.
     * 4. Re-render happens because count changed.
     * 5. Effect does NOT run again because it is no longer listening to 'count'.
     */

    // According to your runComponentEffects logic, it stays at 1
    expect(instance.count).toBe(1);

    const effectStarts = log.filter((l) => l.startsWith("Effect:Run:Count"));
    expect(effectStarts).toHaveLength(1);

    // The render, however, should reflect the latest state
    expect(log).toContain("Render:Count:1");
  });
});
