import { describe, test, expect, vi } from "vitest";
import { Component } from "../../index";
import { __template, __block } from "../../jsx-runtime";
import { renderToString } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";

/**
 * A compiled block hydrated with `__DEV__` false — what a production build ships, since `@ramonda/build`
 * compiles every tree it can. The reports are compiled out; what is left has to do the same work.
 */

/** Two routes' pages: the same root tag, different static content. */
const HOME = __template({ t: "div", a: { id: "home" }, c: ["home"] });
const PLAYERS = __template({ t: "div", a: { id: "players" }, c: ["players"] });

describe("a served block, in production", () => {
  test("from another template is built, not kept, and nothing is reported", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let route = "server";
    class Route extends Component {
      render() {
        return <main>{__block(route === "server" ? PLAYERS : HOME, [])}</main>;
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Route />);
    route = "client";
    hydrateRoot(<Route />, container);
    await Promise.resolve();
    await Promise.resolve();
    const after = {
      html: (container.querySelector("main") as HTMLElement).innerHTML,
      told: warn.mock.calls.length + error.mock.calls.length,
    };
    container.remove();
    vi.restoreAllMocks();
    expect(after).toEqual({ html: '<div id="home">home</div>', told: 0 });
  });

  test("of this template is kept, with what only the server wrote taken away", async () => {
    class Home extends Component {
      render() {
        return <main>{__block(HOME, [])}</main>;
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Home />);
    const served = container.querySelector("#home") as HTMLElement;
    served.setAttribute("data-served", "1");
    hydrateRoot(<Home />, container);
    await Promise.resolve();
    await Promise.resolve();
    const after = { kept: container.querySelector("#home") === served, html: served.outerHTML };
    container.remove();
    expect(after).toEqual({ kept: true, html: '<div id="home">home</div>' });
  });
});
