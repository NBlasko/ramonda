import { describe, expect, test } from "vitest";
import { Component } from "../base/Component";
import { bootstrap } from "../index";

class Panel extends Component {
  render() {
    return <span>panel</span>;
  }
}

class Named extends Component {
  render() {
    return <div id="named">{Panel}</div>;
  }
}

class Written extends Component {
  render() {
    return (
      <div id="written">
        <Panel />
      </div>
    );
  }
}

/**
 * `{Panel}` where `<Panel />` was meant.
 *
 * It renders nothing, and until RMD052 nothing said so: the check beside it looks for an OBJECT
 * among children, and a class is a function, so it fell through with the primitives.
 */
describe("a component among JSX children", () => {
  const records: { code?: string; data?: Record<string, unknown> }[] = [];
  const collect = (): void => {
    records.length = 0;
    (globalThis as { __RAMONDA_DIAGNOSTICS__?: (r: unknown) => void }).__RAMONDA_DIAGNOSTICS__ = (r) =>
      records.push(r as { code?: string });
  };

  test("renders nothing, and says so", () => {
    collect();
    const el = document.createElement("div");
    document.body.appendChild(el);
    bootstrap(<Named />, el);

    // Distinct ids per case: jsdom resolves `#id` through a document-wide map, and a container
    // another test left in the body would answer for this one.
    expect(el.querySelector("#named")?.innerHTML).toBe("");
    const found = records.find((r) => r.code === "RMD052");
    expect(found).toBeDefined();
    expect(found?.data).toMatchObject({ named: "Panel" });
  });

  test("and the element that was meant is silent", () => {
    collect();
    const el = document.createElement("div");
    document.body.appendChild(el);
    bootstrap(<Written />, el);

    expect(el.querySelector("#written")?.textContent).toBe("panel");
    expect(records.filter((r) => r.code === "RMD052")).toEqual([]);
  });
});
