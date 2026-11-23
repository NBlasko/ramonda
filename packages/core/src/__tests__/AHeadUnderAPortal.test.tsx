import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Component, Portal, bootstrap, state, unmount } from "../index";
import { flushSync } from "../testing";
import { Head, resetHeadRegistry } from "../base/Head";
import { PORTAL_ATTR } from "../helpers/constants";

/**
 * A `Head` in content a `Portal` holds, where the component owning both declares the portal FIRST.
 *
 * A `Portal` builds its children in its `@created`, and the creates run in `use()` order — so with the
 * portal first, its children are built before the `Head` beside it publishes. A component's context is
 * its parent's object until it publishes, so the `Head` reserves its component's own object when it is
 * constructed, before any `@created`: measured without that, a `Head` in content the portal built LATER
 * joined the head tree under the layout instead of under its owner, and its title won.
 *
 * Content the portal builds AT ONCE is built before the owner's `Head` publishes into that object, and
 * joins the `Head` above — as on main. That the two moments give two head trees is on the open list.
 */
const containers: HTMLElement[] = [];
let target: HTMLElement;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  for (const container of containers.splice(0)) {
    unmount(container);
    container.remove();
  }
  target.remove();
  vi.restoreAllMocks();
  resetHeadRegistry();
  for (const tag of [...document.head.querySelectorAll(`[${PORTAL_ATTR}]`)]) tag.remove();
  document.title = "";
});

function mount(node: unknown): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  bootstrap(node as never, container);
  flushSync();
  return container;
}

class Inner extends Component {
  head = this.use(Head, () => ({ title: "Inner" }));
  render() {
    return <i />;
  }
}

describe("a Head in a portal declared before its owner's Head", () => {
  test("joins its owner's Head when the portal builds it later", () => {
    const openAtOnce = false;
    let opener: Opens | undefined;
    class Opens extends Component {
      @state open = openAtOnce;
      constructor(...args: ConstructorParameters<typeof Component>) {
        super(...args);
        opener = this;
      }
      render() {
        return <b>{this.open ? <Inner /> : null}</b>;
      }
    }
    class Owner extends Component {
      portal = this.use(Portal, () => ({ children: <Opens />, target }));
      head = this.use(Head, () => ({ title: "Owner" }));
      render() {
        return <p />;
      }
    }
    class Sibling extends Component {
      head = this.use(Head, () => ({ title: "Sibling" }));
      render() {
        return <p />;
      }
    }
    class Layout extends Component {
      head = this.use(Head, () => ({ title: "Layout" }));
      render() {
        return (
          <div>
            <Owner />
            <Sibling />
          </div>
        );
      }
    }
    mount(<Layout />);
    opener!.open = true;
    flushSync();
    // Inner sits under Owner, which comes before Sibling: the later sibling's title is the page's.
    expect(document.title).toBe("Sibling");
  });
});
