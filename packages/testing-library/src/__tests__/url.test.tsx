import { Component } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { describe, expect, test } from "vitest";
import { cleanup, render } from "../index";

/**
 * The page's address, in a test.
 *
 * Found by an agent testing a routed app from the docs alone: to test `/tournament?id=t1` it guessed
 * `history.replaceState` before `render`, and a test that navigated left the NEXT test on that page —
 * measured, the next test started at the URL the one before pushed, because cleanup unmounted the
 * tree and left the address where it was.
 */
class Where extends Component {
  render(): RamondaNode {
    return <p>{window.location.pathname + window.location.search}</p>;
  }
}

const START = window.location.href;

describe("render's url", () => {
  test("is the address the tree is mounted at", () => {
    const { container } = render(<Where />, { url: "/tournament?id=t1" });
    expect(container.textContent).toBe("/tournament?id=t1");
  });

  test("and the test after it starts where the run did, not where the last one went", () => {
    expect(window.location.href).toBe(START);
  });
});

describe("cleanup", () => {
  test("a test that navigates…", () => {
    render(<Where />);
    window.history.pushState(null, "", "/somewhere?x=1");
    expect(window.location.pathname).toBe("/somewhere");
  });

  test("…does not leave the next one there", () => {
    expect(window.location.href).toBe(START);
  });

  test("puts it back when called by hand too", () => {
    window.history.pushState(null, "", "/elsewhere");
    cleanup();
    expect(window.location.href).toBe(START);
  });
});
