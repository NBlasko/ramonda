import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { state, create, destroy } from "../../base/decorators";
import { Hook } from "../../base/Hook";
import { Component } from "../../base/Component";
import { effectLike } from "../../test/effectLike";

let log: string[] = [];

/**
 * Hook to track unique instances in a list
 */
class ItemHook extends Hook<{ id: number }> {
  @create init() {
    log.push(`ItemHook:Init:${this.props.id}`);
  }

  @destroy dispose() {
    log.push(`ItemHook:Cleanup:${this.props.id}`);
  }

  @effectLike() onUpdate() {
    log.push(`ItemHook:Effect:${this.props.id}`);
  }
}

class ListItem extends Component<{ id: number; text: string; key?: number }> {
  hook = this.use(ItemHook, (bag: ListItem) => ({ id: bag.props.id }));

  @create init() {
    log.push(`ListItem:Init:${this.props.id}`);
  }

  @destroy dispose() {
    log.push(`ListItem:Cleanup:${this.props.id}`);
  }

  render() {
    log.push(`ListItem:Render:${this.props.id}`);
    return <li data-id={this.props.id}>{this.props.text}</li>;
  }
}

class ListManager extends Component {
  @state items = [
    { id: 1, text: "First" },
    { id: 2, text: "Second" },
    { id: 3, text: "Third" },
  ];

  render() {
    log.push("ListManager:Render");
    return (
      <ul>
        {this.items.map((item) => (
          <ListItem key={item.id} id={item.id} text={item.text} />
        ))}
      </ul>
    );
  }
}

describe("Reconciliation & List Management", () => {
  test("should mount multiple instances and cleanup only the removed one", async () => {
    log = [];

    // 1. INITIAL MOUNT of 3 items
    const { instance, settle } = await getDOM<ListManager>(<ListManager />);

    expect(log.filter((l) => l.startsWith("ListItem:Init"))).toHaveLength(3);
    expect(log).toContain("ListItem:Init:1");
    expect(log).toContain("ListItem:Init:2");
    expect(log).toContain("ListItem:Init:3");

    log = [];

    // 2. REMOVE MIDDLE ITEM (ID: 2)
    // This tests if diffAndMerge can surgically remove one component
    instance.items = [
      { id: 1, text: "First" },
      { id: 3, text: "Third" },
    ];
    await settle();

    /**
     * Expectations:
     * - Only Item 2 should be cleaned up.
     * - Item 1 and 3 should NOT re-mount (no Init logs for them).
     * - ListManager must re-render.
     */
    expect(log).toContain("ListManager:Render");
    expect(log).toContain("ListItem:Cleanup:2");
    expect(log).toContain("ItemHook:Cleanup:2");

    // Crucial: 1 and 3 should remain stable
    expect(log).not.toContain("ListItem:Cleanup:1");
    expect(log).not.toContain("ListItem:Cleanup:3");
    expect(log).not.toContain("ListItem:Init:1");
    expect(log).not.toContain("ListItem:Init:3");

    log = [];

    // 3. REORDER REMAINING ITEMS
    instance.items = [
      { id: 3, text: "Third" },
      { id: 1, text: "First" },
    ];
    await settle();

    /**
     * If you have 'key' support implemented, components should just move.
     * If not, they might re-mount. This test will reveal your current implementation.
     */
    const reMounts = log.filter((l) => l.includes("Init"));
    expect(reMounts).toHaveLength(0); // Should be 0 if reconciliation is efficient
  });
});
