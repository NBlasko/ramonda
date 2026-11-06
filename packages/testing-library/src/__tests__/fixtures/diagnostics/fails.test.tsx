import { Component, configureDev } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { allowDiagnostics, render } from "../../../index";

// Run by `failOnDiagnostics.test.tsx` in a vitest of its own, and expected to FAIL: the check after
// each test is the whole feature, and only a separate run can watch a test fail.
configureDev({ strictRender: true });

class Rebuilds extends Component {
  render(): RamondaNode {
    return <p data-conf={{ size: 1 } as never}>x</p>;
  }
}

test("causes RMD020 and does not take it", () => {
  render(<Rebuilds />);
});

test("starts with nothing left over from the test that failed", () => {
  // A check that threw before `cleanup` ran left the failed test's tree mounted, and the next test
  // met it — measured on the router's hydration tests, as "a second Router was mounted".
  expect(document.querySelectorAll("p").length).toBe(0);
});

test("causes it and allows it", () => {
  allowDiagnostics("RMD020");
  render(<Rebuilds />);
});
