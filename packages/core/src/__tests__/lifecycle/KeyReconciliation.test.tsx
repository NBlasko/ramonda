import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { state, create, destroy } from "../../base/decorators";
import { Component } from "../../base/Component";
import { KEY_SYM } from "../../helpers/constants";

describe("Key Reconciliation", () => {
  test("key is stored as Symbol property, not as DOM attribute", async () => {
    class Comp extends Component {
      render() {
        return (
          <ul>
            <li key="alpha">a</li>
            <li key="beta">b</li>
          </ul>
        );
      }
    }

    const { container } = await getDOM(<Comp />);
    const items = container.querySelectorAll("li");

    expect(items[0].getAttribute("key")).toBeNull();
    expect(items[1].getAttribute("key")).toBeNull();
    expect((items[0] as any)[KEY_SYM]).toBe("alpha");
    expect((items[1] as any)[KEY_SYM]).toBe("beta");
  });

  test("reorder preserves component instances — no remount", async () => {
    const log: string[] = [];

    class Item extends Component<{ id: number }> {
      @create init() {
        log.push(`mount:${this.props.id}`);
      }
      @destroy dispose() {
        log.push(`unmount:${this.props.id}`);
      }
      render() {
        return <li>{this.props.id}</li>;
      }
    }

    class List extends Component {
      @state items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      render() {
        return (
          <ul>
            {this.items.map((item) => (
              <Item key={item.id} id={item.id} />
            ))}
          </ul>
        );
      }
    }

    const { instance, settle } = await getDOM<List>(<List />);
    expect(log).toEqual(["mount:1", "mount:2", "mount:3"]);
    log.length = 0;

    instance.items = [{ id: 3 }, { id: 1 }, { id: 2 }];
    await settle();

    expect(log).toHaveLength(0);
  });

  test("key=0 (numeric zero) is handled correctly — no remount on reorder", async () => {
    const log: string[] = [];

    class Item extends Component<{ id: number }> {
      @create init() {
        log.push(`mount:${this.props.id}`);
      }
      @destroy dispose() {
        log.push(`unmount:${this.props.id}`);
      }
      render() {
        return <li>{this.props.id}</li>;
      }
    }

    class List extends Component {
      @state items = [{ id: 0 }, { id: 1 }, { id: 2 }];
      render() {
        return (
          <ul>
            {this.items.map((item) => (
              <Item key={item.id} id={item.id} />
            ))}
          </ul>
        );
      }
    }

    const { instance, settle } = await getDOM<List>(<List />);
    expect(log).toEqual(["mount:0", "mount:1", "mount:2"]);
    log.length = 0;

    // Move key=0 from index 0 to the end
    instance.items = [{ id: 1 }, { id: 2 }, { id: 0 }];
    await settle();

    expect(log).toHaveLength(0);
  });

  test("keyed element at index 0 in DOM is correctly found on subsequent renders", async () => {
    // Targets the bug where mapIndexWithKeyes[key] === 0 was falsy, so the
    // keyed lookup was skipped for whatever sat at index 0.

    const instanceIds: Record<string, string> = {};

    class Item extends Component<{ id: string }> {
      readonly uid = Math.random().toString(36).slice(2);

      @create init() {
        instanceIds[this.props.id] = this.uid;
      }

      render() {
        return <li data-id={this.props.id}>{this.props.id}</li>;
      }
    }

    class List extends Component {
      @state items = ["a", "b", "c"];
      render() {
        return (
          <ul>
            {this.items.map((id) => (
              <Item key={id} id={id} />
            ))}
          </ul>
        );
      }
    }

    const { instance, settle } = await getDOM<List>(<List />);
    const originalIds = { ...instanceIds };

    // 'a' je na indexu 0 u DOM-u — reorder ga stavlja na kraj
    instance.items = ["b", "c", "a"];
    await settle();

    // Svi instance ID-ovi moraju biti isti — nema remountovanja
    expect(instanceIds["a"]).toBe(originalIds["a"]);
    expect(instanceIds["b"]).toBe(originalIds["b"]);
    expect(instanceIds["c"]).toBe(originalIds["c"]);
  });

  test("removing a keyed item only unmounts that item", async () => {
    const log: string[] = [];

    class Item extends Component<{ id: number }> {
      @create init() {
        log.push(`mount:${this.props.id}`);
      }
      @destroy dispose() {
        log.push(`unmount:${this.props.id}`);
      }
      render() {
        return <li>{this.props.id}</li>;
      }
    }

    class List extends Component {
      @state items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      render() {
        return (
          <ul>
            {this.items.map((item) => (
              <Item key={item.id} id={item.id} />
            ))}
          </ul>
        );
      }
    }

    const { instance, settle } = await getDOM<List>(<List />);
    log.length = 0;

    instance.items = [{ id: 1 }, { id: 3 }];
    await settle();

    expect(log).toContain("unmount:2");
    expect(log).not.toContain("unmount:1");
    expect(log).not.toContain("unmount:3");
    expect(log).not.toContain("mount:1");
    expect(log).not.toContain("mount:3");
  });
});
