import { describe, test, expect } from "vitest";
import { getDOM, findAll } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";
import { list } from "../base/list";

/**
 * Where a component that owns NO node puts its first one.
 *
 * Every other insertion has a node to work from: the diff holds the run this region owns, and the
 * node after its last one is the place. An empty component has no last node — its render returned
 * nothing — so its position exists only in the record, and the record is what has to be asked. That
 * search is `nextNodeAfter`, and it is the one place the framework works a position out rather than
 * carrying one.
 *
 * The search is over the record in DOCUMENT order, across nesting. It used to stop at the level the
 * component sits on: a region that held it and nothing after it answered "nothing follows", which
 * reads as the end of the parent — so an empty component one level down appended its first markup
 * past every later sibling of its OWNER. Silently, and only on that one render.
 */

class Maybe extends Component<{ mark?: string }> {
  @state open = false;
  render() {
    return this.open ? <b>{this.props.mark ?? "here"}</b> : null;
  }
}

const shell = (container: Element) => container.querySelector("#shell")!.innerHTML;

describe("an empty component's first node", () => {
  test("lands before the later siblings of the component that renders it", async () => {
    class Wrapper extends Component {
      render() {
        return <Maybe />;
      }
    }
    class Shell extends Component {
      render() {
        return (
          <div id="shell">
            <Wrapper />
            <u>after</u>
          </div>
        );
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    expect(shell(app.container)).toBe("<u>after</u>");

    findAll<Maybe>(app.container, "Maybe")[0]!.open = true;
    await app.settle();

    // Before the fix: "<u>after</u><b>here</b>".
    expect(shell(app.container)).toBe("<b>here</b><u>after</u>");
  });

  test("two levels of empty owners deep, with two siblings after them", async () => {
    class Mid extends Component {
      render() {
        return <Maybe />;
      }
    }
    class Wrapper extends Component {
      render() {
        return <Mid />;
      }
    }
    class Shell extends Component {
      render() {
        return (
          <div id="shell">
            <Wrapper />
            <u>after</u>
            <i>last</i>
          </div>
        );
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    findAll<Maybe>(app.container, "Maybe")[0]!.open = true;
    await app.settle();

    // Before the fix: "<u>after</u><i>last</i><b>here</b>".
    expect(shell(app.container)).toBe("<b>here</b><u>after</u><i>last</i>");
  });

  test("inside a list row, with rows after it", async () => {
    class Wrap extends Component {
      render() {
        return <Maybe />;
      }
    }
    class Row extends Component<{ n: number }> {
      render() {
        return [<Wrap />, <span>{this.props.n}</span>];
      }
    }
    class Shell extends Component {
      @state rows = [1, 2, 3];
      row = (n: number) => <Row n={n} key={n} />;
      render() {
        return <div id="shell">{list(this.rows, this.row)}</div>;
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    expect(shell(app.container)).toBe("<span>1</span><span>2</span><span>3</span>");

    // The MIDDLE row's, so a wrong answer is visible on both sides of it.
    findAll<Maybe>(app.container, "Maybe")[1]!.open = true;
    await app.settle();

    // Before the fix: "<span>1</span><span>2</span><span>3</span><b>here</b>".
    expect(shell(app.container)).toBe("<span>1</span><b>here</b><span>2</span><span>3</span>");
  });

  test("two empty components side by side, the second filling in first", async () => {
    class Shell extends Component {
      render() {
        return (
          <div id="shell">
            <Maybe mark="one" />
            <Maybe mark="two" />
            <p>tail</p>
          </div>
        );
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    const both = findAll<Maybe>(app.container, "Maybe");

    both[1]!.open = true;
    await app.settle();
    expect(shell(app.container)).toBe("<b>two</b><p>tail</p>");

    // The one before it now has to find a place ahead of a sibling that has nodes.
    both[0]!.open = true;
    await app.settle();
    expect(shell(app.container)).toBe("<b>one</b><b>two</b><p>tail</p>");
  });

  test("last in its parent, where the end of the parent is the right answer", async () => {
    class Shell extends Component {
      render() {
        return (
          <div id="shell">
            <p>head</p>
            <Maybe mark="last" />
          </div>
        );
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    findAll<Maybe>(app.container, "Maybe")[0]!.open = true;
    await app.settle();
    expect(shell(app.container)).toBe("<p>head</p><b>last</b>");
  });
});
