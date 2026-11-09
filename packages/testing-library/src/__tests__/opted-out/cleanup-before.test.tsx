import "../../dont-cleanup-after-each";
import { Component } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { beforeAll, beforeEach, expect, test } from "vitest";
import { cleanup, render } from "../../index";

// Run by `optedOut.test.ts`: a project that calls `cleanup()` at the START of each test instead. This
// package's own hook runs first, and must not take the last test's address as this one's start.
class Where extends Component {
  render(): RamondaNode {
    return <p>{window.location.pathname}</p>;
  }
}

beforeAll(() => {
  window.history.replaceState(null, "", "/app");
});
beforeEach(() => cleanup());

test("a test that navigates", () => {
  render(<Where />);
  window.history.pushState(null, "", "/elsewhere");
  expect(window.location.pathname).toBe("/elsewhere");
});

test("the next is back where the file put it", () => {
  expect(render(<Where />).container.textContent).toBe("/app");
});
