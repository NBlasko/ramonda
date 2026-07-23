import { test, expect, assert } from "vitest";
import { getDOM } from "../test/setup"; // Proveri putanju
import { Component } from "../base/Component";
import type { EnhancedHTMLNode } from "../types/vdom";

class DiagnosticComponent extends Component<{ name: string }> {
  render() {
    return <div id="real-root">Hello {this.props.name}</div>;
  }
}

test("Diagnostic: Instance Discovery", async () => {
  const { container, instance } = await getDOM<DiagnosticComponent>(<DiagnosticComponent name="Test" />);

  // 1. The instance was found.
  expect(instance).toBeDefined();
  expect(instance.props.name).toBe("Test");

  // 2. The structure: the wrapper element.
  const wrapper = container.firstChild as EnhancedHTMLNode;

  // The instance really does hang off the wrapper.
  expect(wrapper._componentInstance).toBe(instance);

  // 3. The DOM inside it.
  const innerDiv = container.querySelector("#real-root");
  expect(innerDiv).not.toBeNull();
  assert(innerDiv);
  expect(innerDiv.textContent).toContain("Hello Test");
});
