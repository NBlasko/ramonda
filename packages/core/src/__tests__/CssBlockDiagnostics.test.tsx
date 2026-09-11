import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Component } from "../base/Component";
import { resetDiagnostics } from "../debug/diagnostics";
import { getDOM } from "../test/setup";

/**
 * The three ways a compiled style block can reach the runtime wrong, and what each one used to do.
 *
 * ## Why this is last, and why it is here at all
 *
 * The framework owns a prop whose meaning comes from a compiler, and the honest half of that bargain
 * is that a value the two disagree about has to be SAID rather than silently absorbed. Measured
 * before any of these existed:
 *
 * | given | what happened |
 * |---|---|
 * | a descriptor read without being called | the class applied, NO custom property set, silence |
 * | a value holding a `;` | the declaration dropped, silence |
 * | a plain object, or a string | **threw** `Cannot read properties of undefined (reading 'length')` |
 *
 * The first two render a page that is wrong in a way nothing on the screen explains. The third is
 * worse than silence and worse than a report: it takes the render down and names nothing about `css`.
 *
 * The values are built by hand rather than by `@ramonda/css`'s `block()`. That is deliberate: core
 * may not depend on the compiler at any depth, and what is being asserted is what the RUNTIME does
 * with a shape — so the shape is the fixture.
 */

type Record = { code: string; message: string };
let records: Record[];

beforeEach(() => {
  records = [];
  resetDiagnostics();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record as Record);
});

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const codes = () => records.map((record) => record.code);
const of = (code: string) => records.find((record) => record.code === code);

class Card extends Component<{ value: unknown }> {
  render() {
    return <div css={this.props.value as never}>x</div>;
  }
}

const mount = async (value: unknown) => {
  const { container } = await getDOM(<Card value={value} />);
  return container.querySelector("div") as HTMLElement;
};

/** What the compiler emits for a block WITH holes, read without being called. */
const descriptor = () => {
  const uncalled = () => ({});
  return Object.assign(uncalled, {
    className: "r-aaaaaaaaaaaaaaaa",
    properties: ["--r-aaaaaaaaaaaaaaaa-0", "--r-aaaaaaaaaaaaaaaa-1"],
    values: [] as readonly string[],
  });
};

const value = (values: readonly unknown[]) => ({
  className: "r-bbbbbbbbbbbbbbbb",
  properties: ["--r-bbbbbbbbbbbbbbbb-0"],
  values,
});

describe("RMD062 — a block applied with no values for its holes", () => {
  test("is reported, and says which properties are not set", async () => {
    const node = await mount(descriptor());

    expect(codes()).toContain("RMD062");
    expect(of("RMD062")?.message).toContain("--r-aaaaaaaaaaaaaaaa-0");
    expect(of("RMD062")?.message).toContain("--r-aaaaaaaaaaaaaaaa-1");

    // And the claim the prose makes: the class is there and the properties are not.
    expect(node.className).toBe("r-aaaaaaaaaaaaaaaa");
    expect(node.style.getPropertyValue("--r-aaaaaaaaaaaaaaaa-0")).toBe("");
  });

  test("says nothing when every hole has one", async () => {
    await mount(value(["4px"]));

    expect(codes()).not.toContain("RMD062");
  });

  test("and nothing for a block with no holes at all", async () => {
    await mount({ className: "r-cccccccccccccccc", properties: [], values: [] });

    expect(codes()).toEqual([]);
  });
});

describe("RMD063 — a value that would be a second declaration", () => {
  test("is reported, and the declaration is dropped", async () => {
    const node = await mount(value(["red; position: fixed"]));

    expect(codes()).toContain("RMD063");
    expect(of("RMD063")?.message).toContain("--r-bbbbbbbbbbbbbbbb-0");

    // The claim the prose makes: not written at all, rather than written and hoped about.
    expect(node.style.getPropertyValue("--r-bbbbbbbbbbbbbbbb-0")).toBe("");
    expect(node.getAttribute("style")).toBeNull();
  });

  test("an ordinary value is written and says nothing", async () => {
    const node = await mount(value(["4px solid red"]));

    expect(codes()).toEqual([]);
    expect(node.style.getPropertyValue("--r-bbbbbbbbbbbbbbbb-0")).toBe("4px solid red");
  });
});

describe("RMD064 — a value that is not a compiled block", () => {
  test.each([
    ["a plain object", { className: "x" }],
    ["a string", "nonsense"],
    ["a number", 4],
  ])("%s is reported and ignored rather than thrown", async (_what, given) => {
    const node = await mount(given);

    expect(codes()).toContain("RMD064");
    // The render survived, which is the whole point — it used to throw.
    expect(node.textContent).toBe("x");
  });

  test("the message says what the value actually was", async () => {
    await mount({ className: "r-dddddddddddddddd", properties: ["--a"] });

    expect(of("RMD064")?.message).toContain("`values` as undefined");
  });

  /** And the class is not merged from a value that is not a block — one fault, one report. */
  test("the element gets no class out of it", async () => {
    const node = await mount({ className: "r-eeeeeeeeeeeeeeee", properties: ["--a"] });

    expect(node.className).toBe("");
    expect(codes()).toEqual(["RMD064"]);
  });
});
