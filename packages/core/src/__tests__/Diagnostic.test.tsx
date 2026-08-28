import { test, expect, assert } from "vitest";
import { getDOM } from "../test/setup"; // Proveri putanju
import { Component } from "../base/Component";
import { getComponentInstance } from "../testing";

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

  // 2. The structure: there is NO wrapper. The component's render output is the container's
  //    first child, and the instance is found through the record rather than off a node.
  expect((container.firstChild as Element).id).toBe("real-root");
  expect(getComponentInstance(container.firstChild)).toBe(instance);

  // 3. The DOM inside it.
  const innerDiv = container.querySelector("#real-root");
  expect(innerDiv).not.toBeNull();
  assert(innerDiv);
  expect(innerDiv.textContent).toContain("Hello Test");
});
