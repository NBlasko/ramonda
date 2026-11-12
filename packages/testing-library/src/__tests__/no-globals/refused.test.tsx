import { expect, test } from "vitest";
import { Component } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { render } from "../../index";

// Run by `noGlobals.test.ts` in a vitest with `globals: false`, where there is no `afterEach` to hook.
class Plain extends Component {
  render(): RamondaNode {
    return <p>x</p>;
  }
}

test("render refuses, and says what is missing and both ways out", () => {
  expect(() => render(<Plain />)).toThrow(/found no global `afterEach`/);
  expect(() => render(<Plain />)).toThrow(
    /unmount what a test rendered, or fail a test that caused a development diagnostic/,
  );
  expect(() => render(<Plain />)).toThrow(/globals: true/);
  expect(() => render(<Plain />)).toThrow(/dont-cleanup-after-each/);
  expect(() => render(<Plain />)).toThrow(/dont-fail-on-diagnostics/);
  // Refused before anything was mounted: nothing is left in the document to leak.
  expect(document.body.innerHTML).toBe("");
});
