import { Component } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { beforeAll, describe, expect, test } from "vitest";
import { render } from "../index";

/**
 * A file that sets the address ONCE, for every test in it. Cleanup puts the address back after each
 * test — to where THAT test started, not where the run did: taken once when this package loaded, it
 * sent every test after the first back to the run's address. Found by review.
 */
class Where extends Component {
  render(): RamondaNode {
    return <p>{window.location.pathname}</p>;
  }
}

beforeAll(() => {
  window.history.replaceState(null, "", "/app");
});

describe("an address set in beforeAll", () => {
  test("is where the first test runs", () => {
    expect(render(<Where />).container.textContent).toBe("/app");
  });

  test("and where the second one runs too", () => {
    expect(render(<Where />).container.textContent).toBe("/app");
  });
});
