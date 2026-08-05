import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Host } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD028 — markup a parser is not allowed to keep where the JSX put it.
 *
 * The reason this needs a diagnostic of its own is that nothing else says the right thing. The
 * client builds the DOM with `appendChild` and everything works; a server render goes through a
 * parser, which moves the element; and hydration then reports RMD007 — a mismatch — whose advice
 * is about `new Date()` in `render()`. The reader goes looking for a bug that is not there.
 */

let logs: string[] = [];

beforeEach(() => {
  resetDiagnostics();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => vi.restoreAllMocks());

const reported = () => logs.join("\n");

describe("RMD028", () => {
  test("a block element inside a <p>, which is the common one", async () => {
    class Card extends Component {
      render() {
        return (
          <p>
            intro
            <div>a block</div>
          </p>
        );
      }
    }

    await getDOM(<Card />);

    expect(reported()).toContain("RMD028");
    expect(reported()).toContain("<div> is a block element and it is inside a <p>");
    // The part RMD007 cannot say: what the parser will do about it.
    expect(reported()).toContain("makes the <div> its SIBLING");
  });

  test("the whole flow-content family closes a <p>, not just <div>", async () => {
    class Card extends Component {
      render() {
        return (
          <p>
            <ul>
              <li>one</li>
            </ul>
          </p>
        );
      }
    }

    await getDOM(<Card />);
    expect(reported()).toContain("RMD028");
    expect(reported()).toContain("<ul>");
  });

  test("inline content inside a <p> is fine", async () => {
    class Card extends Component {
      render() {
        return (
          <p>
            some <strong>bold</strong> and a <a href="#x">link</a>
          </p>
        );
      }
    }

    await getDOM(<Card />);
    expect(reported()).not.toContain("RMD028");
  });

  test("a list item outside a list", async () => {
    class Menu extends Component {
      render() {
        return (
          <div>
            <li>orphan</li>
          </div>
        );
      }
    }

    await getDOM(<Menu />);
    expect(reported()).toContain("<li> belongs inside a list");
  });

  test("a row outside a table, and a cell outside a row", async () => {
    class Rows extends Component {
      render() {
        return (
          <div>
            <tr>
              <td>cell</td>
            </tr>
          </div>
        );
      }
    }

    await getDOM(<Rows />);
    expect(reported()).toContain("<tr> belongs inside a table");
    // The cell is fine — it IS inside a row. Only the row is misplaced.
    expect(reported()).not.toContain("<td> belongs");
  });

  test("a properly built table says nothing", async () => {
    class Table extends Component {
      render() {
        return (
          <table>
            <tbody>
              <tr>
                <td>cell</td>
              </tr>
            </tbody>
          </table>
        );
      }
    }

    await getDOM(<Table />);
    expect(reported()).not.toContain("RMD028");
  });

  test("a form inside a form, which the parser drops outright", async () => {
    class Nested extends Component {
      render() {
        return (
          <form>
            <form>
              <input name="inner" />
            </form>
          </form>
        );
      }
    }

    await getDOM(<Nested />);
    expect(reported()).toContain("RMD028");
    expect(reported()).toContain("dropped by the parser outright");
  });

  test("a link inside a link", async () => {
    class Links extends Component {
      render() {
        return (
          <a href="#outer">
            outer <a href="#inner">inner</a>
          </a>
        );
      }
    }

    await getDOM(<Links />);
    expect(reported()).toContain("closes the outer <a>");
  });

  /**
   * A component between the two tags is the framework's own element, not the app's. RMD010 owns
   * that case and can name the `@Host` to reach for, which this cannot.
   */
  test("a misplaced element under a default host is left to RMD010", async () => {
    class Row extends Component {
      render() {
        return <li>from a component</li>;
      }
    }

    class Menu extends Component {
      render() {
        return (
          <ul>
            <Row />
          </ul>
        );
      }
    }

    await getDOM(<Menu />);
    expect(reported()).not.toContain("RMD028");
  });

  test("a component that IS the element is checked like any other", async () => {
    @Host("li")
    class Row extends Component {
      render() {
        return <span>proper</span>;
      }
    }

    class Wrong extends Component {
      render() {
        return (
          <div>
            <Row />
          </div>
        );
      }
    }

    await getDOM(<Wrong />);

    // The host IS an <li>, so the pair the parser will see is div > li.
    expect(reported()).toContain("<li> belongs inside a list");
  });

  test("the same pair is reported once, however many times it is rendered", async () => {
    class Many extends Component {
      render() {
        return (
          <div>
            <li>one</li>
            <li>two</li>
            <li>three</li>
          </div>
        );
      }
    }

    await getDOM(<Many />);
    expect(reported().split("RMD028").length - 1).toBe(1);
  });
});
