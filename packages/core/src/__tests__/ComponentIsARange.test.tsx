import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state, mounted, destroyed } from "../base/decorators";
import { Component } from "../base/Component";
import { list } from "../base/list";
import { componentAt, componentsIn } from "../core/DiffAndMerge";
import { COMPONENT_RUNTIME } from "../core/runtime";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";

const microtask = () => Promise.resolve();

/**
 * A component owns a RANGE of its parent's children, not one element.
 *
 * This is the file that pins the whole point of it: the cases a host element made impossible, and
 * the cases a host element used to make trivial and which must still hold now that there is none.
 *
 * Nothing here declares a host, because there is nothing to declare. What a component renders is
 * what lands in the parent.
 */
describe("a component is a range", () => {
  test("two cells from one component land inside the <tr>", async () => {
    class PersonCells extends Component<{ name: string; age: number }> {
      render() {
        return [<td className="name">{this.props.name}</td>, <td className="age">{this.props.age}</td>];
      }
    }

    class Table extends Component {
      render() {
        return (
          <table>
            <tbody>
              <tr className="person">
                <PersonCells name="Ana" age={31} />
              </tr>
            </tbody>
          </table>
        );
      }
    }

    const { container } = await getDOM(<Table />);

    // The whole reason the host had to go: an element here is fostered out of the table by the
    // parser, which is what RMD010 existed to refuse.
    expect(container.querySelector("tr.person")!.innerHTML).toBe('<td class="name">Ana</td><td class="age">31</td>');
    expect(container.querySelectorAll("tr.person > td")).toHaveLength(2);
  });

  test("nothing extra is in the DOM — one JSX tag, one node", async () => {
    class Inner extends Component {
      render() {
        return <b>deep</b>;
      }
    }
    class Middle extends Component {
      render() {
        return <Inner />;
      }
    }
    class Outer extends Component {
      render() {
        return (
          <p id="p">
            <Middle />
          </p>
        );
      }
    }

    const { container } = await getDOM(<Outer />);

    // Three components, one element between them all. No wrapper, no comment, nothing.
    expect(container.innerHTML).toBe('<p id="p"><b>deep</b></p>');
  });

  test("a component that renders nothing holds its place, and comes back", async () => {
    class Maybe extends Component {
      @state open = false;
      render() {
        return this.open ? <b>here</b> : null;
      }
    }

    class Shell extends Component {
      render() {
        return (
          <div id="shell">
            <i>before</i>
            <Maybe />
            <u>after</u>
          </div>
        );
      }
    }

    const { container, settle } = await getDOM(<Shell />);
    const shell = () => container.querySelector("#shell")!.innerHTML;

    expect(shell()).toBe("<i>before</i><u>after</u>");

    /**
     * Flipped through the component's OWN state, which is the path that matters here.
     *
     * An empty component owns no node, so when it starts producing markup there is nothing of its
     * own to place that markup relative to — and its parent is not re-rendering, so nobody hands it
     * a position. This is the one case where the framework has to work the insertion point out from
     * the siblings in the record, and getting it wrong puts the markup in the wrong place silently.
     */
    const maybeInstance = findInstance(container.querySelector("#shell")!, "Maybe") as { open: boolean };
    maybeInstance.open = true;
    await settle();
    expect(shell()).toBe("<i>before</i><b>here</b><u>after</u>");

    maybeInstance.open = false;
    await settle();
    expect(shell()).toBe("<i>before</i><u>after</u>");
  });

  test("the same component in two places keeps two states", async () => {
    class Counter extends Component {
      @state n = 0;
      render() {
        return <span className="n">{this.n}</span>;
      }
    }
    class Two extends Component {
      render() {
        return (
          <div>
            <Counter />
            <Counter />
          </div>
        );
      }
    }

    const { container, settle } = await getDOM(<Two />);
    const spans = () => Array.from(container.querySelectorAll("span.n")).map((s) => s.textContent);

    expect(spans()).toEqual(["0", "0"]);

    const first = findInstance(container.querySelectorAll("span.n")[0]!, "Counter") as { n: number };
    first.n = 7;
    await settle();
    expect(spans()).toEqual(["7", "0"]);
  });

  test("a component's node count may change between renders", async () => {
    class Grows extends Component {
      @state many = false;
      render() {
        return this.many ? [<b>a</b>, <b>b</b>, <b>c</b>] : <b>a</b>;
      }
    }
    class Shell extends Component {
      render() {
        return (
          <div id="s">
            <Grows />
            <i>tail</i>
          </div>
        );
      }
    }

    const { container, settle } = await getDOM(<Shell />);
    const inner = () => container.querySelector("#s")!.innerHTML;

    expect(inner()).toBe("<b>a</b><i>tail</i>");

    const grows = findInstance(container.querySelector("b")!, "Grows") as { many: boolean };
    grows.many = true;
    await settle();
    expect(inner()).toBe("<b>a</b><b>b</b><b>c</b><i>tail</i>");

    grows.many = false;
    await settle();
    expect(inner()).toBe("<b>a</b><i>tail</i>");
  });

  test("a dropped component is torn down, though it never had an element", async () => {
    const log: string[] = [];

    class Leaf extends Component {
      @mounted up() {
        log.push("up");
      }
      @destroyed down() {
        log.push("down");
      }
      render() {
        return null;
      }
    }

    class Shell extends Component {
      @state on = true;
      render() {
        return <div id="s">{this.on ? <Leaf /> : null}</div>;
      }
    }

    const { container, settle } = await getDOM(<Shell />);
    expect(log).toEqual(["up"]);

    const shell = findInstance(container.querySelector("#s")!, "Shell") as { on: boolean };
    shell.on = false;
    await settle();

    // The teardown is reached through the RECORD — there is no node to find this component on.
    expect(log).toEqual(["up", "down"]);
  });

  test("rows of a list may be components with no element of their own", async () => {
    interface Row {
      id: number;
      title: string;
    }

    class Cells extends Component<{ row: Row }> {
      render() {
        return [<td className="id">{this.props.row.id}</td>, <td className="t">{this.props.row.title}</td>];
      }
    }

    class Grid extends Component {
      @state rows: Row[] = [
        { id: 1, title: "one" },
        { id: 2, title: "two" },
      ];
      render() {
        return (
          <table>
            <tbody id="b">
              {list(this.rows, (row: Row) => (
                <tr key={row.id}>
                  <Cells row={row} />
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
    }

    const { container, settle } = await getDOM(<Grid />);
    const cells = () => Array.from(container.querySelectorAll("td")).map((td) => td.textContent);

    expect(cells()).toEqual(["1", "one", "2", "two"]);

    const grid = findInstance(container.querySelector("#b")!, "Grid") as { rows: Row[] };
    grid.rows = [grid.rows[1], grid.rows[0]];
    await settle();
    expect(cells()).toEqual(["2", "two", "1", "one"]);
  });
});

describe("markers live only in served markup", () => {
  test("the server writes them, hydration consumes them, and the DOM ends up clean", async () => {
    class Cells extends Component<{ name: string }> {
      @state hits = 3;
      render() {
        return [<td className="n">{this.props.name}</td>, <td className="h">{this.hits}</td>];
      }
    }

    class Page extends Component {
      render() {
        return (
          <table>
            <tbody>
              <tr>
                <Cells name="Ana" />
              </tr>
            </tbody>
          </table>
        );
      }
    }

    const html = await renderToString(<Page />);

    /**
     * The pair delimits the block, and BOTH are comments — the only thing the parser leaves inside a
     * `<tr>`, which is the whole reason the design can work at all.
     *
     * No blob here, and that is correct rather than a miss: `hits` still holds what its own
     * initializer produced, and the client's initializer produces it again, so sending it buys
     * nothing. `INITIAL_PRIMITIVES` is what decides that; the test below covers a value that really
     * did change on the server.
     */
    expect(html).toMatch(/<tr><!--c\d+--><td class="n">Ana<\/td><td class="h">3<\/td><!--\/c\d+--><\/tr>/);

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    hydrateRoot(<Page />, container);
    await microtask();

    // Nothing of the markers is left. This is the promise the whole design rests on: a page that
    // came from the server ends up holding exactly what a client render would have produced.
    expect(container.innerHTML).not.toContain("<!--");
    expect(container.querySelector("tr")!.innerHTML).toBe('<td class="n">Ana</td><td class="h">3</td>');

    container.remove();
  });

  test("the state on the marker is restored, not re-initialised", async () => {
    class Counter extends Component {
      @state n = 0;
      @mounted bump() {
        this.n = 41;
      }
      render() {
        return <span id="n">{this.n}</span>;
      }
    }

    const html = await renderToString(<Counter />);
    expect(html).toContain('{"state":{"n":41}');

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    hydrateRoot(<Counter />, container);
    await microtask();

    // 41 came off the marker. A fresh client render would have said 0 and then 41 on mount, which is
    // a different thing and would have shown as a flash.
    expect(container.querySelector("#n")!.textContent).toBe("41");
    expect(container.innerHTML).not.toContain("<!--");

    container.remove();
  });
});

/**
 * The named component whose markup this node is part of.
 *
 * `componentAt` answers with the INNERMOST one, which is the right answer to its own question and
 * usually not the one a test is holding a node for. From there the chain of owners is walked, which
 * is the only way outwards now: a component has no element, so there is no ancestor node to ask.
 */
function findInstance<T = unknown>(node: Node, name: string): T {
  let at = componentAt(node);
  while (at !== undefined) {
    if (at.constructor.name === name) return at as T;
    at = at[COMPONENT_RUNTIME].parent;
  }

  /**
   * A component that owns no node cannot be found FROM a node, and that is not a gap to work
   * around: `componentAt` answers "which component is this node in", and an empty component
   * contains nothing. The record is what knows it is there, so the record is what to ask.
   */
  for (const candidate of componentsIn(node)) {
    if (candidate.constructor.name === name) return candidate as T;
  }

  throw new Error(`no <${name} /> owns this node`);
}

describe("a region's node set is derived, not remembered", () => {
  /**
   * A nested component that re-renders on its own, and then its ANCESTOR re-renders.
   *
   * The bug this pins: the region used to cache the nodes it held, and only the region that
   * re-rendered updated its own cache. So an ancestor was left holding nodes a descendant had
   * already detached — and the ancestor's next render read `nextSibling` on one of them, got `null`,
   * and read that as "the end of the parent". Its fresh markup landed past every later sibling.
   *
   * Nothing is cached now: the previous set is flattened out of `entries`, which every region keeps
   * current for itself, so an ancestor walking it sees what is really in the document.
   */
  test("an ancestor re-rendering after a descendant did puts its markup in the right place", async () => {
    class Maybe extends Component {
      @state open = true;
      render() {
        return this.open ? <b id="inner">inner</b> : null;
      }
    }

    class Wrapper extends Component {
      @state extra = false;
      render() {
        return this.extra ? [<Maybe />, <em id="new">new</em>] : [<Maybe />];
      }
    }

    class Shell extends Component {
      render() {
        return (
          <div id="shell">
            <Wrapper />
            <span id="tail">tail</span>
          </div>
        );
      }
    }

    const { container, settle } = await getDOM(<Shell />);
    const shell = () => container.querySelector("#shell")!.innerHTML;

    expect(shell()).toBe('<b id="inner">inner</b><span id="tail">tail</span>');

    // The DESCENDANT re-renders on its own and gives up its node.
    findInstance<{ open: boolean }>(container.querySelector("#shell")!, "Maybe").open = false;
    await settle();
    expect(shell()).toBe('<span id="tail">tail</span>');

    // Now the ANCESTOR re-renders and adds markup. It has to land inside its own block — before the
    // tail, which is its sibling and not its child.
    findInstance<{ extra: boolean }>(container.querySelector("#shell")!, "Wrapper").extra = true;
    await settle();
    expect(shell()).toBe('<em id="new">new</em><span id="tail">tail</span>');
  });

  /**
   * RMD016 says a component updated while its markup is out of the document, and it read the same
   * cache — so a component whose descendant had just replaced a node was accused of being orphaned
   * while its parent was in the document the whole time.
   *
   * A node that is not connected is not evidence. Only a component whose PARENT has left is.
   */
  test("a healthy component is not reported as orphaned after a descendant re-renders", async () => {
    const codes: string[] = [];
    const handler = (event: Event) => {
      const message = (event as CustomEvent<{ message: string }>).detail.message;
      const code = message.match(/^\[(RMD\d+)\]/)?.[1];
      if (code) codes.push(code);
    };
    window.addEventListener("ramonda:dev-log", handler);

    class Leaf extends Component {
      @state shown = true;
      render() {
        return this.shown ? <i id="leaf">leaf</i> : <b id="leaf">leaf</b>;
      }
    }

    class Holder extends Component {
      @state n = 0;
      render() {
        return [<Leaf />, <u id="count">{this.n}</u>];
      }
    }

    try {
      const { container, settle } = await getDOM(
        <div>
          <Holder />
        </div>,
      );

      // The descendant swaps its element, which detaches the node the holder's record started with.
      findInstance<{ shown: boolean }>(container.querySelector("#leaf")!, "Leaf").shown = false;
      await settle();

      codes.length = 0;
      findInstance<{ n: number }>(container.querySelector("#count")!, "Holder").n = 1;
      await settle();

      expect(container.querySelector("#count")!.textContent).toBe("1");
      expect(codes).not.toContain("RMD016");

      /**
       * And the listener really hears this channel, so the assertion above is not vacuous.
       *
       * A capture that silently attached to the wrong event name would make every `not.toContain`
       * pass against nothing — a green test proving only that the wiring broke.
       */
      const orphan = findInstance<{ n: number }>(container.querySelector("#count")!, "Holder");
      container.querySelector("div")!.remove();
      orphan.n = 2;
      await settle();
      expect(codes).toContain("RMD016");
    } finally {
      window.removeEventListener("ramonda:dev-log", handler);
    }
  });
});
