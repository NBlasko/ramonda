import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { state, effect } from "../../base/decorators";
import { Component } from "../../base/Component";

let log: string[] = [];

/**
 * Component that triggers a chain reaction of updates
 */
class CascadeComponent extends Component {
  @state stage = "initial";
  @state finalValue = 0;

  @effect onStageChange() {
    log.push(`Effect:Stage:${this.stage}`);

    if (this.stage === "triggered") {
      // Triggering a second state change from within an effect
      log.push("Action:Setting:FinalValue");
      this.finalValue = 100;
    }
  }

  @effect onFinalValueChange() {
    if (this.finalValue > 0) {
      log.push(`Effect:FinalValue:${this.finalValue}`);
    }
  }

  render() {
    log.push(`Render:Stage:${this.stage}:Value:${this.finalValue}`);
    return <div>{this.stage}</div>;
  }
}

describe("Effect Cascade and Async Batching", () => {
  test("should handle state changes triggered by effects correctly", async () => {
    log = [];

    // 1. Initial Render
    const { instance, settle } = await getDOM<CascadeComponent>(<CascadeComponent />);

    expect(log).toContain("Render:Stage:initial:Value:0");
    expect(log).toContain("Effect:Stage:initial");

    log = [];

    // 2. Trigger the cascade
    instance.stage = "triggered";

    /**
     * What should happen:
     * 1. stage changes -> schedules Render 1
     * 2. Render 1 happens -> stage is 'triggered'
     * 3. Effect 1 runs -> sees 'triggered' -> sets finalValue = 100
     * 4. Setting finalValue schedules Render 2
     * 5. Render 2 happens -> value is 100
     * 6. Effect 2 runs -> sees finalValue 100
     */
    await settle();

    // Verify the sequence
    const renderLogs = log.filter((l) => l.startsWith("Render:Stage:triggered"));

    // It should render once for the stage change, and then again for the finalValue change
    expect(renderLogs).toHaveLength(2);

    // Check specific sequence
    expect(log).toEqual([
      "Render:Stage:triggered:Value:0", // Render 1
      "Effect:Stage:triggered", // Effect 1 starts
      "Action:Setting:FinalValue", // Effect 1 triggers state change
      "Render:Stage:triggered:Value:100", // Render 2 (due to finalValue)
      "Effect:FinalValue:100", // Effect 2 runs after Render 2
    ]);
  });
});
