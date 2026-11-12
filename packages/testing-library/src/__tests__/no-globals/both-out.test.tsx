import "../../dont-cleanup-after-each";
import "../../dont-fail-on-diagnostics";
import { expect, test } from "vitest";
import { Component } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { cleanup, render } from "../../index";

class Plain extends Component {
  render(): RamondaNode {
    return <p>x</p>;
  }
}

test("a project that said it does both itself renders", () => {
  const { container } = render(<Plain />);
  expect(container.textContent).toBe("x");
  cleanup();
});
