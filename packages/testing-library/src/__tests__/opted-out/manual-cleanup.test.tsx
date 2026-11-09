import "../../dont-cleanup-after-each";
import { Component } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { afterEach, beforeAll, expect, test } from "vitest";
import { cleanup, render } from "../../index";

// Run by `optedOut.test.ts` in a vitest of its own: the opt-out is for the whole run.
class Where extends Component {
  render(): RamondaNode {
    return <p>{window.location.pathname}</p>;
  }
}

beforeAll(() => {
  window.history.replaceState(null, "", "/app");
});
afterEach(() => cleanup());

test("a test that navigates", () => {
  render(<Where />);
  window.history.pushState(null, "", "/elsewhere");
  expect(window.location.pathname).toBe("/elsewhere");
});

test("the next is back where the file put it, not where the run started", () => {
  expect(render(<Where />).container.textContent).toBe("/app");
});
