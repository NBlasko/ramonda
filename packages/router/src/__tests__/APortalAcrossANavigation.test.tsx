import { beforeEach, describe, test, expect } from "vitest";
import { Component, created, destroyed, Portal } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { render, act } from "@ramonda/testing-library";
import { Router, RouteOutlet, Navigator } from "../Router";
import { createRoutes } from "../match";

/**
 * Queue item 7: a `Portal` open while the route changes underneath it.
 *
 * A portal renders into a target somewhere else in the document — `document.body` for a modal — so
 * its content is NOT inside the subtree the router swaps. Nothing about the DOM says the two are
 * connected, and the only thing that takes a modal away when its page leaves is the component tree:
 * the portal belongs to whoever declared it, and that owner is unmounted with the route.
 *
 * Which makes the question "whose modal is it". A page's goes with the page; the shell's stays open
 * across every navigation. Both halves are here, because a framework that got the second one wrong
 * would leave a modal on screen with no page behind it, and one that got the first wrong would leave
 * a modal that belongs to a route nobody is on.
 *
 * ## Driving back/forward
 *
 * `history.back()` is asynchronous in jsdom and `act` does not wait for it — the assertions ran
 * while the page had not moved, and the first reading said `back()` did nothing at all. Wait for the
 * `popstate` event itself.
 */
let route: Navigator;

/** The shell owns a modal of its own, which no navigation should touch. */
class Shell extends Component<{ children?: RamondaNode }> {
  router = this.use(Router);
  portal = this.use(Portal, () => ({
    target: document.body,
    children: <div id="shell-modal">shell</div>,
  }));
  render() {
    return <div>{this.props.children}</div>;
  }
}

const lifecycle: string[] = [];

/** A page with a modal of its OWN, which should leave when it does. */
class Home extends Component {
  hook = this.use(Navigator);
  @created expose() {
    route = this.hook;
    lifecycle.push("home created");
  }
  @destroyed gone() {
    lifecycle.push("home destroyed");
  }
  portal = this.use(Portal, () => ({
    target: document.body,
    children: (
      <div className="page-modal" id="home-modal">
        home
      </div>
    ),
  }));
  render() {
    return <div id="home">home</div>;
  }
}

/** Another page with its own modal, into the SAME target. */
class Other extends Component {
  hook = this.use(Navigator);
  @created expose() {
    route = this.hook;
    lifecycle.push("other created");
  }
  portal = this.use(Portal, () => ({
    target: document.body,
    children: (
      <div className="page-modal" id="other-modal">
        other
      </div>
    ),
  }));
  render() {
    return <div id="other">other</div>;
  }
}

const routes = createRoutes({ "/": <Home />, "/other": <Other />, "*": <i id="nf" /> });
const app = () => (
  <Shell>
    <RouteOutlet routes={routes} />
  </Shell>
);

beforeEach(() => {
  window.history.pushState(null, "", "/");
  lifecycle.length = 0;
});

const seen = () => ({
  shellModal: document.querySelectorAll("#shell-modal").length,
  pageModals: [...document.querySelectorAll(".page-modal")].map((node) => node.id),
  page: document.querySelector("#home") ? "home" : document.querySelector("#other") ? "other" : "none",
  path: window.location.pathname,
});

/** `history.back()` resolves on its own schedule; `act` alone runs before the route has moved. */
const goBack = async () => {
  const popped = new Promise<void>((resolve) => {
    window.addEventListener("popstate", () => resolve(), { once: true });
  });
  await act(async () => {
    route.back();
  });
  await popped;
  await act(async () => {});
};

describe("a Portal open while the route changes", () => {
  test("a page's modal leaves with its page and the shell's stays", async () => {
    render(app());
    expect(seen()).toEqual({
      shellModal: 1,
      pageModals: ["home-modal"],
      page: "home",
      path: "/",
    });

    await act(async () => {
      route.push("/other");
    });

    expect(seen()).toEqual({
      shellModal: 1,
      pageModals: ["other-modal"],
      page: "other",
      path: "/other",
    });
  });

  /**
   * Both pages aim at the same target, so a teardown that removed everything IN the target rather
   * than everything the portal OWNS would take the shell's modal with it — and the two pages'
   * modals would fight over one another. The count is what says it did not: one shell modal and
   * exactly one page modal, at every step.
   */
  test("and the page's modal comes back on the way back", async () => {
    render(app());
    await act(async () => {
      route.push("/other");
    });

    await goBack();

    expect(seen()).toEqual({
      shellModal: 1,
      pageModals: ["home-modal"],
      page: "home",
      path: "/",
    });
  });

  /**
   * The order a navigation runs in, which is what makes a shared target safe: the leaving page is
   * fully torn down before the arriving one is created, so there is never a moment with two page
   * modals in the document.
   */
  test("the leaving page is destroyed before the arriving one is created", async () => {
    render(app());
    lifecycle.length = 0;

    await act(async () => {
      route.push("/other");
    });

    expect(lifecycle).toEqual(["home destroyed", "other created"]);
  });

  /**
   * A navigation the app did not initiate. `push` goes through the Navigator, which knows what it is
   * doing; a browser Back arrives from the outside, and the portals have to follow it just the same.
   */
  test("a browser Back moves the page's modal too", async () => {
    render(app());
    await act(async () => {
      route.push("/other");
    });
    expect(seen().pageModals).toEqual(["other-modal"]);

    await goBack();

    expect(seen().pageModals).toEqual(["home-modal"]);
    expect(seen().shellModal).toBe(1);
  });
});
