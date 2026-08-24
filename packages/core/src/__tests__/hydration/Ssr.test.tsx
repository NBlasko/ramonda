import { describe, test, expect } from "vitest";
import { state, mounted } from "../../base/decorators";
import { Component } from "../../base/Component";
import { renderToString } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";

const microtask = () => Promise.resolve();

describe("SSR wiring", () => {
  test("runs server/shared lifecycle (not client/effects) and stamps blobs", async () => {
    class Counter extends Component {
      @state count = 0;
      // shared @mounted → runs on the server, after the initial render.
      @mounted ready() {
        this.count = 5;
      }
      // client-only effect → must NOT run/attach on the server.
      onClick() {
        this.count++;
      }
      render() {
        return (
          <div onclick={this.onClick}>
            <span id="c">{this.count}</span>
          </div>
        );
      }
    }

    const html = await renderToString(<Counter />);

    // Parse the server markup to inspect it robustly.
    const probe = document.createElement("div");
    probe.innerHTML = html;

    // @mounted (shared) ran on the server → count reflected.
    expect(probe.querySelector("#c")?.textContent).toBe("5");

    /**
     * The blob rides the OPENING MARKER, and holds the server's state.
     *
     * It used to be an attribute on the component's host element. A component owns a range of nodes
     * now, so the address of its state is the comment in front of that range — which is also the
     * only marker a parser leaves inside a `<tr>`.
     */
    const opening = Array.from(probe.childNodes).find((n) => n.nodeType === 8) as Comment;
    const blob = JSON.parse(opening.data.slice(opening.data.indexOf(" ") + 1));
    expect(blob.state.count).toBe(5);
  });

  test("round-trip: renderToString → hydrateRoot → interactive", async () => {
    class Counter extends Component {
      @state count = 0;
      @mounted ready() {
        this.count = 3;
      }
      onClick() {
        this.count++;
      }
      render() {
        return (
          <div onclick={this.onClick}>
            <span id="c">{this.count}</span>
          </div>
        );
      }
    }

    const html = await renderToString(<Counter />);

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    // Server HTML shows the state; no listeners yet.
    expect(container.querySelector("#c")?.textContent).toBe("3");

    hydrateRoot(<Counter />, container);

    // Shared @mounted is NOT re-run on the client (state came from the blob),
    // and the client-only listener is now attached.
    (container.firstElementChild as HTMLElement).dispatchEvent(new MouseEvent("click"));
    await microtask();
    expect(container.querySelector("#c")?.textContent).toBe("4");

    container.remove();
  });

  test("nested components each get a blob and render server-side", async () => {
    class Item extends Component<{ label: string }> {
      @state n = 0;
      @mounted ready() {
        this.n = this.props.label.length;
      }
      render() {
        return (
          <div>
            <span data-item={this.props.label}>{this.n}</span>
          </div>
        );
      }
    }

    class List extends Component {
      render() {
        return (
          <div>
            <ul>
              <Item label="ab" />
              <Item label="xyz" />
            </ul>
          </div>
        );
      }
    }

    const html = await renderToString(<List />);
    const probe = document.createElement("div");
    probe.innerHTML = html;

    expect(probe.querySelector('[data-item="ab"]')?.textContent).toBe("2");
    expect(probe.querySelector('[data-item="xyz"]')?.textContent).toBe("3");

    /**
     * Each Item has its own marker pair inside the `<ul>`, and its own blob on the opening one.
     *
     * There is no per-item element to carry it: an Item renders an `<li>` and that `<li>` is the
     * Item's own markup, not a wrapper the framework put there. The comments are what say which
     * `<li>` belongs to which component.
     */
    const openings = Array.from(probe.querySelector("ul")!.childNodes).filter(
      (n) => n.nodeType === 8 && (n as Comment).data.startsWith("c"),
    ) as Comment[];
    expect(openings).toHaveLength(2);
    openings.forEach((c) => expect(c.data).toContain('"state"'));
  });
});
