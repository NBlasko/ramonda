import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Host } from "../base/decorators";
import { Component } from "../base/Component";
import { renderToString } from "../hydration/ssr";
import { resetDiagnostics } from "../debug/diagnostics";

function captureDiagnostics() {
  const codes: string[] = [];
  const messages: string[] = [];
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as { message: string };
    const code = detail.message.match(/^\[(RMD\d+)\]/)?.[1];
    if (!code) return;
    codes.push(code);
    messages.push(detail.message);
  };
  window.addEventListener("ramonda:dev-log", handler);
  return {
    codes,
    messages,
    stop: () => window.removeEventListener("ramonda:dev-log", handler),
  };
}

/** No @Host, so it gets the default <ramonda-host>. */
class Row extends Component {
  render() {
    return (
      <tr>
        <td>cell</td>
      </tr>
    );
  }
}

class Plain extends Component {
  render() {
    return <span>hi</span>;
  }
}

@Host("tr")
class ProperRow extends Component {
  render() {
    return <td>cell</td>;
  }
}

describe("default host placement (RMD010)", () => {
  let captured: ReturnType<typeof captureDiagnostics>;

  beforeEach(() => {
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
    captured = captureDiagnostics();
  });

  afterEach(() => {
    captured.stop();
    vi.restoreAllMocks();
  });

  test("the default host survives an HTML round-trip", async () => {
    // The whole reason the host stopped being a <template>: a template's
    // children are moved into its inert .content on parse, so SSR emitted an
    // empty tag for every default-host component.
    @Host("div")
    class Page extends Component {
      render() {
        return (
          <div className="page">
            <Plain />
          </div>
        );
      }
    }

    const html = await renderToString(<Page />);
    expect(html).toContain("<ramonda-host");
    expect(html).toContain("<span>hi</span>");

    const back = document.createElement("div");
    back.innerHTML = html;
    const host = back.querySelector("ramonda-host")!;

    expect(host.childNodes.length).toBe(1);
    expect(host.textContent).toBe("hi");
    expect(captured.codes).toEqual([]);
  });

  test("the default host inside <tbody> is reported with the tag to use", async () => {
    @Host("div")
    class TableApp extends Component {
      render() {
        return (
          <table>
            <tbody>
              <Row />
            </tbody>
          </table>
        );
      }
    }

    await getDOM(<TableApp />);

    expect(captured.codes).toEqual(["RMD010"]);
    expect(captured.messages[0]).toContain("<Row />");
    expect(captured.messages[0]).toContain("inside <tbody>");
  });

  test("the parser really does split the component in two", async () => {
    // Not a hypothetical, and worse than "lands in the wrong place": the parser
    // foster-parents the host out in front of the <table> EMPTY, then re-parses
    // its children into the table on their own. Host and content end up in
    // different subtrees, with the state blob on the empty one.
    @Host("div")
    class TableApp extends Component {
      render() {
        return (
          <table>
            <tbody>
              <Row />
            </tbody>
          </table>
        );
      }
    }

    const html = await renderToString(<TableApp />);
    // Before the parser sees it, the tree is exactly what was rendered.
    expect(html).toContain("<tbody><ramonda-host");

    const back = document.createElement("div");
    back.innerHTML = html;

    const host = back.querySelector("ramonda-host")!;
    const row = back.querySelector("tr")!;

    expect(host.childNodes.length).toBe(0);
    expect(host.parentElement!.nodeName).toBe("DIV");
    expect(host.contains(row)).toBe(false);
    expect(row.parentElement!.nodeName).toBe("TBODY");
  });

  test("the default host inside <svg> is reported, and suggests g", async () => {
    @Host("div")
    class SvgApp extends Component {
      render() {
        return (
          <svg>
            <Plain />
          </svg>
        );
      }
    }

    await getDOM(<SvgApp />);

    expect(captured.codes).toEqual(["RMD010"]);
    expect(captured.messages[0]).toContain("which is SVG");
  });

  test("the default host inside <select> is reported — it is deleted outright", async () => {
    class Opt extends Component {
      render() {
        return <option>x</option>;
      }
    }

    @Host("div")
    class Picker extends Component {
      render() {
        return (
          <select>
            <Opt />
          </select>
        );
      }
    }

    const html = await renderToString(<Picker />);
    const back = document.createElement("div");
    back.innerHTML = html;

    // Worse than the table: the host does not move, it disappears.
    expect(back.querySelector("ramonda-host")).toBeNull();
    expect(back.querySelector("option")).not.toBeNull();

    // The server render mounts the host too, so it already reported.
    expect(captured.codes).toEqual(["RMD010"]);
    expect(captured.messages[0]).toContain("vanishes");
  });

  test("<ul> is NOT reported — the parser leaves it alone", async () => {
    // The trap this check nearly fell into. A <ul>'s content model says "only
    // <li>", so it looks like it belongs with <table> — but foster-parenting is
    // a table rule, and the host round-trips through <ul> untouched. Warning
    // here would fire on the most common list in any app, for no defect.
    class Item extends Component {
      render() {
        return <li>x</li>;
      }
    }

    @Host("div")
    class List extends Component {
      render() {
        return (
          <ul>
            <Item />
          </ul>
        );
      }
    }

    const html = await renderToString(<List />);
    const back = document.createElement("div");
    back.innerHTML = html;

    const host = back.querySelector("ramonda-host")!;
    expect(host.parentElement!.nodeName).toBe("UL");
    expect(host.querySelector("li")).not.toBeNull();
    expect(captured.codes).toEqual([]);
  });

  test("the guidance RMD010 gives actually survives a round-trip", async () => {
    // The prescribed fix has to be tested, or the diagnostic is just an opinion.
    // "Become the element the parent expects" — a component is one element, and
    // render() may return an array, so one <tr> holds as many <td>s as it likes.
    @Host("tr")
    class Cells extends Component<{ cells: string[] }> {
      render() {
        return this.props.cells.map((c) => <td>{c}</td>);
      }
    }

    // Several rows means being the container — and a <table> may hold more than
    // one <tbody>, so a component per section is legal HTML.
    @Host("tbody")
    class Section extends Component<{ title: string }> {
      render() {
        return [<Cells cells={[this.props.title, "1"]} />, <Cells cells={[this.props.title, "2"]} />];
      }
    }

    @Host("div")
    class TableApp extends Component {
      render() {
        return (
          <table>
            <Section title="x" />
            <Section title="y" />
          </table>
        );
      }
    }

    const html = await renderToString(<TableApp />);
    const back = document.createElement("div");
    back.innerHTML = html;

    // Byte-for-byte: the parser changed nothing, so hydration has an exact match.
    expect(back.innerHTML).toBe(html);
    expect(back.querySelectorAll("tbody").length).toBe(2);
    expect(back.querySelectorAll("tr").length).toBe(4);
    expect(back.querySelectorAll("td").length).toBe(8);
    expect(back.querySelector("ramonda-host")).toBeNull();
    expect(captured.codes).toEqual([]);
  });

  test("an explicit @Host is left alone", async () => {
    // The suggestion is only ever about the default host; once the developer
    // has chosen a tag, the choice is theirs.
    @Host("div")
    class TableApp extends Component {
      render() {
        return (
          <table>
            <tbody>
              <ProperRow />
            </tbody>
          </table>
        );
      }
    }

    await getDOM(<TableApp />);

    expect(captured.codes).toEqual([]);
  });

  test("the default host in an ordinary parent is not reported", async () => {
    // Most parents accept it, and this is the common case — a check that fired
    // here would fire on nearly every component.
    @Host("div")
    class Page extends Component {
      render() {
        return (
          <div>
            <p>
              <Plain />
            </p>
          </div>
        );
      }
    }

    await getDOM(<Page />);

    expect(captured.codes).toEqual([]);
  });
});
