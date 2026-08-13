import { describe, expect, test } from "vitest";
import { Component } from "../base/Component";
import { bootstrap } from "../index";

class Named extends Component {
  render() {
    return <span>named</span>;
  }
}

class Host extends Component {
  render() {
    return <div id="host">{Named}</div>;
  }
}

describe("a component class written as a CHILD", () => {
  test("what lands in the DOM", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const records: unknown[] = [];
    (globalThis as { __RAMONDA_DIAGNOSTICS__?: (r: unknown) => void }).__RAMONDA_DIAGNOSTICS__ = (r) => records.push(r);
    bootstrap(<Host />, el);
    console.log("HTML:", el.innerHTML);
    console.log("records:", JSON.stringify(records));
    expect(true).toBe(true);
  });
});
