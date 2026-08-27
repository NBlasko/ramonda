import { describe, test, expect } from "vitest";
import { getDOM, findAll } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";
import { list } from "../base/list";

/**
 * What a sibling may and may not do to a component's run of nodes.
 *
 * A component owns a RANGE, and the range's length is a render's answer rather than a property of
 * the component: two nodes now, one after the next update, none after the one after that. So every
 * question a single-node child answered by reading `childNodes` — where does it start, where does it
 * end, which of these are mine — is answered by the record instead, and the failure mode when the
 * record and the document disagree is a sibling standing in a component's place with its content
 * patched over it. The page still reads correctly, which is what makes it worth pinning.
 *
 * These are the shapes to attack: ranges moving as a unit, ranges changing length between siblings
 * that do not move, and a range disappearing and coming back.
 */

const shell = (container: Element) => container.querySelector("#shell")!.innerHTML;

describe("a component's range among its siblings", () => {
  test("two ranges of two nodes swap as units, between plain siblings that stay put", async () => {
    class Pair extends Component<{ label: string }> {
      render() {
        return [<b>{this.props.label}1</b>, <i>{this.props.label}2</i>];
      }
    }
    class Shell extends Component {
      @state order = ["a", "b"];
      render() {
        return (
          <div id="shell">
            <p>head</p>
            {this.order.map((l) => (
              <Pair key={l} label={l} />
            ))}
            <p>tail</p>
          </div>
        );
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    const head = app.container.querySelector("p")!;
    expect(shell(app.container)).toBe("<p>head</p><b>a1</b><i>a2</i><b>b1</b><i>b2</i><p>tail</p>");

    app.instance.order = ["b", "a"];
    await app.settle();

    expect(shell(app.container)).toBe("<p>head</p><b>b1</b><i>b2</i><b>a1</b><i>a2</i><p>tail</p>");
    // The siblings that did not move were not touched either.
    expect(app.container.querySelector("p")).toBe(head);
  });

  test("a range grows from one node to three, and shrinks back, between siblings", async () => {
    class Grower extends Component {
      @state many = false;
      render() {
        return this.many ? [<b>1</b>, <b>2</b>, <b>3</b>] : <b>1</b>;
      }
    }
    class Shell extends Component {
      render() {
        return (
          <div id="shell">
            <p>head</p>
            <Grower />
            <p>tail</p>
          </div>
        );
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    const grower = findAll<Grower>(app.container, "Grower")[0]!;

    grower.many = true;
    await app.settle();
    expect(shell(app.container)).toBe("<p>head</p><b>1</b><b>2</b><b>3</b><p>tail</p>");

    grower.many = false;
    await app.settle();
    expect(shell(app.container)).toBe("<p>head</p><b>1</b><p>tail</p>");
  });

  test("a range shrinks while the component AFTER it holds nodes of its own", async () => {
    class Grower extends Component {
      @state many = true;
      render() {
        return this.many ? [<b>1</b>, <b>2</b>] : [<b>1</b>];
      }
    }
    class Tail extends Component {
      render() {
        return <u>tail</u>;
      }
    }
    class Shell extends Component {
      render() {
        return (
          <div id="shell">
            <Grower />
            <Tail />
          </div>
        );
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    const tail = app.container.querySelector("u")!;
    const grower = findAll<Grower>(app.container, "Grower")[0]!;

    grower.many = false;
    await app.settle();

    expect(shell(app.container)).toBe("<b>1</b><u>tail</u>");
    // The neighbour's node, not a rebuilt one: the shrinking range gave up its own node only.
    expect(app.container.querySelector("u")).toBe(tail);
  });

  test("a component between two others is dropped by the parent and comes back in place", async () => {
    class Mark extends Component<{ mark: string }> {
      render() {
        return <span id={this.props.mark}>{this.props.mark}</span>;
      }
    }
    class Shell extends Component {
      @state middle = true;
      render() {
        return (
          <div id="shell">
            <Mark mark="a" />
            {this.middle ? <Mark mark="b" /> : null}
            <Mark mark="c" />
          </div>
        );
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    const a = app.container.querySelector("#a")!;
    const c = app.container.querySelector("#c")!;

    app.instance.middle = false;
    await app.settle();
    expect(shell(app.container)).toBe('<span id="a">a</span><span id="c">c</span>');
    // `c` did not slide into `b`'s node: the slot is what identifies a child, not the position.
    expect(app.container.querySelector("#c")).toBe(c);

    app.instance.middle = true;
    await app.settle();
    expect(shell(app.container)).toBe('<span id="a">a</span><span id="b">b</span><span id="c">c</span>');
    expect(app.container.querySelector("#a")).toBe(a);
    expect(app.container.querySelector("#c")).toBe(c);
  });

  test("a range that grew on its own is then moved by the parent", async () => {
    class Row extends Component<{ label: string }> {
      @state extra = false;
      render() {
        return this.extra ? [<b>{this.props.label}</b>, <i>{this.props.label}+</i>] : [<b>{this.props.label}</b>];
      }
    }
    class Shell extends Component {
      @state order = ["a", "b"];
      render() {
        return (
          <div id="shell">
            {this.order.map((l) => (
              <Row key={l} label={l} />
            ))}
          </div>
        );
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    findAll<Row>(app.container, "Row")[0]!.extra = true;
    await app.settle();
    expect(shell(app.container)).toBe("<b>a</b><i>a+</i><b>b</b>");

    // The parent knows nothing about that second node — the region it moves is whatever the region
    // says it holds now.
    app.instance.order = ["b", "a"];
    await app.settle();
    expect(shell(app.container)).toBe("<b>b</b><b>a</b><i>a+</i>");
  });

  test("an empty component in a list row that MOVES, and then fills in", async () => {
    class Maybe extends Component<{ mark: string }> {
      @state open = false;
      render() {
        return this.open ? <b>{this.props.mark}</b> : null;
      }
    }
    class Row extends Component<{ n: string }> {
      render() {
        return [<Maybe mark={this.props.n} />, <span>{this.props.n}</span>];
      }
    }
    class Shell extends Component {
      @state rows = ["a", "b"];
      row = (n: string) => <Row n={n} key={n} />;
      render() {
        return <div id="shell">{list(this.rows, this.row)}</div>;
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    expect(shell(app.container)).toBe("<span>a</span><span>b</span>");

    app.instance.rows = ["b", "a"];
    await app.settle();
    expect(shell(app.container)).toBe("<span>b</span><span>a</span>");

    const moved = findAll<Maybe>(app.container, "Maybe").find((m) => m.props.mark === "a")!;
    moved.open = true;
    await app.settle();

    // Its row is second now, and that is where its first node goes.
    expect(shell(app.container)).toBe("<span>b</span><b>a</b><span>a</span>");
  });
});
