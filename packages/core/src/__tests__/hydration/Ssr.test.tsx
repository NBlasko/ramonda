import { describe, test, expect } from "vitest";
import { state, Host, mounted, onElement } from "../../base/decorators";
import { Component } from "../../base/Component";
import { renderToString } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";
import { STATE_ATTR } from "../../helpers/constants";

const microtask = () => Promise.resolve();

describe("SSR wiring", () => {
  test("runs server/shared lifecycle (not client/effects) and stamps blobs", async () => {
    @Host("div")
    class Counter extends Component {
      @state count = 0;
      // shared @mounted → runs on the server, after the initial render.
      @mounted ready() {
        this.count = 5;
      }
      // client-only effect → must NOT run/attach on the server.
      @onElement("click")
      onClick() {
        this.count++;
      }
      render() {
        return <span id="c">{this.count}</span>;
      }
    }

    const html = await renderToString(<Counter />);

    // Parse the server markup to inspect it robustly.
    const probe = document.createElement("div");
    probe.innerHTML = html;
    const host = probe.firstElementChild!;

    // @mounted (shared) ran on the server → count reflected.
    expect(host.querySelector("#c")?.textContent).toBe("5");

    // Blob embedded on the carrier and holds the server state.
    const blob = JSON.parse(host.getAttribute(STATE_ATTR)!);
    expect(blob.state.count).toBe(5);
  });

  test("round-trip: renderToString → hydrateRoot → interactive", async () => {
    @Host("div")
    class Counter extends Component {
      @state count = 0;
      @mounted ready() {
        this.count = 3;
      }
      @onElement("click")
      onClick() {
        this.count++;
      }
      render() {
        return <span id="c">{this.count}</span>;
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
    @Host("div")
    class Item extends Component<{ label: string }> {
      @state n = 0;
      @mounted ready() {
        this.n = this.props.label.length;
      }
      render() {
        return <span data-item={this.props.label}>{this.n}</span>;
      }
    }

    @Host("div")
    class List extends Component {
      render() {
        return (
          <ul>
            <Item label="ab" />
            <Item label="xyz" />
          </ul>
        );
      }
    }

    const html = await renderToString(<List />);
    const probe = document.createElement("div");
    probe.innerHTML = html;

    expect(probe.querySelector('[data-item="ab"]')?.textContent).toBe("2");
    expect(probe.querySelector('[data-item="xyz"]')?.textContent).toBe("3");

    // Each Item carrier (a <div> host under the <ul>) has its own blob.
    const itemHosts = probe.querySelectorAll("ul > div");
    expect(itemHosts).toHaveLength(2);
    itemHosts.forEach((h) => expect(h.hasAttribute(STATE_ATTR)).toBe(true));
  });
});
