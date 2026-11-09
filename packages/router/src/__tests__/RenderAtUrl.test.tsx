import { describe, expect, test } from "vitest";
import { Component, created } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { Navigator, RouteOutlet, Router } from "../Router";
import { createRoutes } from "../match";

/**
 * A routed app, tested at a given address — `render(<App />, { url })` — and a test that navigates
 * not leaving the next one on its page. Found by an agent testing a routed app from the docs alone,
 * which guessed `history.replaceState` and then met the URL of the test before it.
 */
let nav!: Navigator;
const routes = createRoutes({
  "/": <p>home</p>,
  "/tournament": <p>tournament</p>,
});
class Keeper extends Component {
  hook = this.use(Navigator);
  @created keep() {
    nav = this.hook;
  }
  render(): RamondaNode {
    return <i>{this.hook.searchParams.id ?? ""}</i>;
  }
}
class App extends Component {
  router = this.use(Router);
  render(): RamondaNode {
    return (
      <div>
        <Keeper />
        <RouteOutlet routes={routes} />
      </div>
    );
  }
}

describe("a routed app in a test", () => {
  test("renders the page its url names, query included", () => {
    const { container } = render(<App />, { url: "/tournament?id=t1" });
    expect(container.querySelector("p")?.textContent).toBe("tournament");
    expect(container.querySelector("i")?.textContent).toBe("t1");
  });

  test("a test that starts at a url and navigates…", async () => {
    const { container } = render(<App />, { url: "/" });
    await act(async () => nav.push("/tournament"));
    expect(container.querySelector("p")?.textContent).toBe("tournament");
  });

  test("…leaves the next one on the page the run started at", () => {
    const { container } = render(<App />);
    expect(container.querySelector("p")?.textContent).toBe("home");
  });
});
