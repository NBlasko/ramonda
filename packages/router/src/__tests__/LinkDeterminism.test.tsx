import { beforeEach, describe, test, expect } from "vitest";
import { Component, Host } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { render, fireEvent } from "@ramonda/testing-library";
import { Router } from "../Router";
import { Link } from "../Link";

/**
 * A <Link> must navigate to exactly the URL it renders.
 *
 * The two ways of following a link take different paths through the code: a
 * middle click / "open in new tab" / a crawler reads the `href` ATTRIBUTE, while
 * a plain left click is intercepted and routed through `updateState`. If those
 * two derive the destination separately they can disagree, and the same link
 * then means two different things depending on how it was clicked.
 */

@Host("div")
class RouterApp extends Component<{ children?: RamondaNode }> {
  router = this.use(Router);
  render() {
    return this.props.children;
  }
}

/**
 * There used to be a `withApp` helper here whose only job was a try/finally
 * around `unmount`, because a `cleanup()` at the end of a test body is skipped
 * when an assertion throws — and a live Router surviving into the next test made
 * every later test in this file fail with "a second Router was mounted", hiding
 * the one real failure behind a cascade.
 *
 * `@ramonda/testing-library` unmounts after every test whether it passed or not,
 * so the helper is gone and the tests say what they mean.
 */
beforeEach(() => {
  window.history.pushState(null, "", "/");
});

describe("Link determinism", () => {
  /**
   * The href is sanitized at render but the click handler tested the RAW prop,
   * so a value sanitize rejects rendered as "/" while the click resolved it
   * relative to the current URL. Middle click went to "/", left click did not.
   */
  test("a click goes to the same place the rendered href points at", () => {
    const { container } = render(
      <RouterApp>
        <Link href="evil.com/path">Go</Link>
      </RouterApp>,
    );

    const a = container.querySelector("a")!;
    // sanitizeHref rejects a bare host and falls back to the root.
    expect(a.getAttribute("href")).toBe("/");

    fireEvent.click(a, { button: 0 });

    // Whatever happened — native or intercepted — we must not land anywhere the
    // rendered href never named.
    expect(window.location.pathname).toBe("/");
  });

  test("a normal href still routes, and lands exactly where it points", () => {
    const { container } = render(
      <RouterApp>
        <Link href="/players/9?tab=film">Go</Link>
      </RouterApp>,
    );

    const a = container.querySelector("a")!;
    const rendered = a.getAttribute("href");
    expect(rendered).toBe("/players/9?tab=film");

    fireEvent.click(a, { button: 0 });
    expect(window.location.pathname + window.location.search).toBe(rendered);
  });
});
