import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { Component } from "../../base/Component";
import { Host, state, created } from "../../base/decorators";
import { Portal } from "../../base/Portal";
import { portalTarget, PORTAL_TARGET_ATTR } from "../../base/portalTarget";
import { renderPage, renderDocument } from "../../index";
import { hydrateRoot } from "../../hydration/hydrate";
import { unmountChildrenNodes } from "../../core/DiffAndMerge";

/**
 * A portal into a target that is NOT `document.head`, across the server→client
 * boundary.
 *
 * `document.head` worked because the server's document has one. Every other
 * target is a live `Element`, and on the server there is no such thing: the shell
 * is a string the app assembles AFTER the render, so the `<div>` a modal wants to
 * live in does not exist while the tree is being built. That is the whole reason
 * a body target was client-only.
 *
 * So a target outside the app's root is named rather than pointed at.
 * `portalTarget("modals")` is a token: on the server it collects into a detached
 * container the page hands back, on the client it resolves to the element the
 * shell emitted — and the block inside it is delimited by the same anchors every
 * portal block is, so hydration adopts it exactly like a head one.
 *
 * A target INSIDE your own render stays an ordinary `Element` — you have the
 * node, and that is the "inline" case Portal already documents.
 */

const modals = portalTarget("modals");

function containers(): Element[] {
  return [...document.querySelectorAll(`[${PORTAL_TARGET_ATTR}]`)];
}

beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  for (const node of containers()) node.remove();
});

describe("a portal into a named target", () => {
  test("the server collects its block, keyed by the target's name", async () => {
    class Page extends Component {
      portal = this.use(Portal, {
        children: <div class="modal">hello</div>,
        target: modals,
      });
      render() {
        return <p>page</p>;
      }
    }

    const page = await renderPage(<Page />);

    // Not in the body — that is the point of a portal.
    expect(page.body).not.toContain("modal");
    expect(page.portals.modals).toContain('class="modal"');
    expect(page.portals.modals).toContain("hello");
  });

  test("renderDocument puts each collected block in a container of its own", async () => {
    class Page extends Component {
      portal = this.use(Portal, {
        children: <div class="modal">hello</div>,
        target: modals,
      });
      render() {
        return <p>page</p>;
      }
    }

    const html = renderDocument(await renderPage(<Page />));

    expect(html).toContain(`<div ${PORTAL_TARGET_ATTR}="modals">`);
    expect(html).toContain('class="modal"');
    // After the app root, so a modal is not inside the stacking context it is
    // trying to escape.
    expect(html.indexOf(`${PORTAL_TARGET_ATTR}="modals"`)).toBeGreaterThan(html.indexOf('id="app"'));
  });

  test("the client adopts the server's block instead of building a second one", async () => {
    @Host("div")
    class Page extends Component {
      portal = this.use(Portal, {
        children: <div class="modal">hello</div>,
        target: modals,
      });
      render() {
        return <p>page</p>;
      }
    }

    const page = await renderPage(<Page />);

    // What the browser receives: the shell's container, and the app root.
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div ${PORTAL_TARGET_ATTR}="modals">${page.portals.modals}</div>`,
    );
    const serverModal = document.querySelector(".modal");
    expect(serverModal).not.toBeNull();

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    expect(document.querySelectorAll(".modal")).toHaveLength(1);
    expect(document.querySelector(".modal")).toBe(serverModal);

    unmountChildrenNodes([container as unknown as never]);
    expect(document.querySelectorAll(".modal")).toHaveLength(0);
    container.remove();
  });

  test("a component inside one restores the state the server gave it", async () => {
    // The same promise a head portal got: the block goes through the ordinary
    // hydration walk, so a component in it is hydrated rather than rebuilt.
    let clientCreates = 0;

    class Dialog extends Component {
      @state n = 0;

      @created({ env: "server" })
      fill(): void {
        this.n = 7;
      }

      @created({ env: "client" })
      count(): void {
        clientCreates++;
      }

      render() {
        return <div class="dialog">{String(this.n)}</div>;
      }
    }

    @Host("div")
    class Page extends Component {
      portal = this.use(Portal, { children: <Dialog />, target: modals });
      render() {
        return <p>page</p>;
      }
    }

    const page = await renderPage(<Page />);
    expect(page.portals.modals).toContain(">7<");

    document.body.insertAdjacentHTML(
      "beforeend",
      `<div ${PORTAL_TARGET_ATTR}="modals">${page.portals.modals}</div>`,
    );
    const serverDialog = document.querySelector(".dialog");

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    expect(document.querySelector(".dialog")).toBe(serverDialog);
    expect(document.querySelector(".dialog")?.textContent).toBe("7");
    expect(clientCreates).toBe(1);

    unmountChildrenNodes([container as unknown as never]);
    container.remove();
  });

  test("with no server render, the container is made on demand", async () => {
    // A client-only app never receives a shell container. Building one keeps the
    // two paths the same shape, so a portal is not a thing that only works when
    // the page was server rendered.
    const { getDOM } = await import("../../test/setup");

    @Host("div")
    class Page extends Component {
      portal = this.use(Portal, {
        children: <div class="modal">client</div>,
        target: modals,
      });
      render() {
        return <p>page</p>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    await app.settle();

    const container = document.querySelector(`[${PORTAL_TARGET_ATTR}="modals"]`);
    expect(container).not.toBeNull();
    expect(container?.querySelector(".modal")?.textContent).toBe("client");
    expect(app.container.querySelector(".modal")).toBeNull();
  });
});
