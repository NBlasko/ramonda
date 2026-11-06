import "../../dont-cleanup-after-each";
import { expect, test } from "vitest";
import { Component } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { render } from "../../index";

class Plain extends Component {
  render(): RamondaNode {
    return <p>x</p>;
  }
}

test("one half said, and only the other is asked for", () => {
  let said = "";
  try {
    render(<Plain />);
  } catch (error) {
    said = (error as Error).message;
  }
  expect(said).toContain("fail a test that caused a development diagnostic");
  expect(said).not.toContain("unmount what a test rendered");
  expect(said).toContain("dont-fail-on-diagnostics");
  expect(said).not.toContain('dont-cleanup-after-each";');
});
