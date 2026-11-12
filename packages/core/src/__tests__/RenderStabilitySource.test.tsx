import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { list } from "../base/list";
import { state } from "../base/decorators";
import { configureDev } from "../config";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD020 says the file and line the element was written at.
 *
 * Found by an agent building an app from the docs alone: the report named
 * `row > section[3] > div[0].list.each`, a path through the rendered output, and finding the
 * line meant counting sections in a file it had not opened. The compiler hands the development
 * runtime the place every tag was written — Vite and vitest both do — and nothing read it.
 */
const HERE = fileURLToPath(import.meta.url);

/**
 * Where a tag is in THIS file, found by its text — never a number written here, which goes stale
 * the moment the formatter moves a line, and then names a brace.
 */
function placeOf(tag: string): { line: number; column: number } {
  const lines = readFileSync(HERE, "utf8").split("\n");
  const line = lines.findIndex((text) => text.includes(tag));
  return { line: line + 1, column: lines[line].indexOf(tag) + 1 };
}

let records: RamondaDiagnostic[] = [];
beforeEach(() => {
  records = [];
  resetDiagnostics();
  configureDev({ strictRender: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
});
afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  configureDev({ strictRender: false });
  vi.restoreAllMocks();
});

class Inline extends Component {
  save() {}
  render() {
    return (
      <section>
        <p>text</p>
        <button onclick={() => this.save()}>save</button>
      </section>
    );
  }
}

class Rows extends Component {
  @state items = [1, 2];
  pick() {}
  render() {
    return (
      <ul>
        {list(this.items, (n) => (
          <li onclick={() => this.pick()}>{n}</li>
        ))}
      </ul>
    );
  }
}

describe("RMD020 names where the element was written", () => {
  test("the file, line and column of the tag holding the rebuilt value, in the message and the record", async () => {
    await getDOM(<Inline />);
    const found = records.find((record) => record.code === "RMD020");
    expect(found).toBeDefined();
    // The <button>, which is where the arrow is written.
    const at = placeOf("<button onclick=");
    expect(found?.data).toMatchObject({ file: HERE, ...at });
    expect(found?.message).toContain(`${HERE}:${at.line}:${at.column}`);
  });

  test("and in a list row, which is where the path told a reader least", async () => {
    await getDOM(<Rows />);
    const found = records.find((record) => record.code === "RMD020");
    // The row's <li>.
    expect(found?.data).toMatchObject({ file: HERE, ...placeOf("<li onclick=") });
  });
});
