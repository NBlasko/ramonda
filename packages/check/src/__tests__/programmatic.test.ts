// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { analyzeProject, docsPage, explainPage, reportOf } from "../index";

/**
 * The checker as a library, for a program that is not the CLI — the MCP server above all.
 *
 * Each half is the CLI's own: the report is the object `--json` prints, built by the same function,
 * and the pages are the ones `docs` and `explain` print. A second copy of either would be the second
 * place a rule's message or a page's path could drift.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const fixtureDir = (name: string) => join(here, "fixtures", name);
const fixture = (name: string) => join(fixtureDir(name), "tsconfig.json");

const HELPER = `import { Component } from "@ramonda/core";

export class Probe extends Component {
  render() {
    const head = (key: string) => <th>{key}</th>;
    return <tr>{head("a")}{head("b")}</tr>;
  }
}
`;

describe("a file that is only in memory", () => {
  test("is checked as part of the project, as if it were on disk", () => {
    const probe = join(fixtureDir("ok"), "probe.tsx");
    const report = reportOf(analyzeProject(fixture("ok"), { files: { [probe]: HELPER } }));
    const found = report.findings.filter((one) => one.file?.endsWith("probe.tsx"));
    expect(found.map((one) => `${one.code}:${one.line}`)).toEqual(["markup-helper-in-render:5"]);
    expect(report.ok).toBe(false);
  });

  test("replaces what the disk holds for that path", () => {
    const app = join(fixtureDir("ok"), "app.tsx");
    const before = reportOf(analyzeProject(fixture("ok")));
    expect(before.ok).toBe(true);
    const after = reportOf(analyzeProject(fixture("ok"), { files: { [app]: HELPER } }));
    expect(after.findings.map((one) => one.code)).toContain("markup-helper-in-render");
    // Nothing was written: the disk still holds the clean file.
    expect(readFileSync(app, "utf8")).not.toContain("const head");
  });
});

describe("reportOf", () => {
  test("is the object `--json` prints", () => {
    const cli = spawnSync(process.execPath, [join(root, "bin.mjs"), fixture("unknown-hook-option"), "--json"], {
      encoding: "utf8",
    });
    const printed = JSON.parse(cli.stdout);
    const built = JSON.parse(JSON.stringify(reportOf(analyzeProject(fixture("unknown-hook-option")))));
    expect(built).toEqual(printed);
  });
});

describe("the docs, read by a program", () => {
  const scratch: string[] = [];
  const before = process.env.RAMONDA_CHECK_DOCS;
  afterEach(() => {
    if (before === undefined) delete process.env.RAMONDA_CHECK_DOCS;
    else process.env.RAMONDA_CHECK_DOCS = before;
  });
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });
  const packed = () => {
    const dir = mkdtempSync(join(tmpdir(), "check-docs-api-"));
    scratch.push(dir);
    const pages: Record<string, string> = {
      "llms.txt": "# Ramonda\n\n> The index.\n",
      "index.md": "# Ramonda\n",
      "forms/fields.md": "# Fields\n",
      "reference/diagnostics/rmd020.md": "# RMD020 — rendered twice\n",
      "rules/unknown-hook-option.md": "# unknown-hook-option\n",
    };
    for (const [file, text] of Object.entries(pages)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
    process.env.RAMONDA_CHECK_DOCS = dir;
  };

  test("a page by its path, the index with none, and what was meant by a slip", () => {
    packed();
    expect(docsPage()).toEqual({ found: true, text: "# Ramonda\n\n> The index.\n" });
    expect(docsPage("/forms/fields")).toEqual({ found: true, text: "# Fields\n" });
    expect(docsPage("forms/feilds")).toMatchObject({ found: false, meant: ["forms/fields"] });
  });

  test("a code or a rule explained, and what was meant by a slip", () => {
    packed();
    expect(explainPage("rmd020")).toEqual({ found: true, text: "# RMD020 — rendered twice\n" });
    expect(explainPage("unknown-hook-option")).toEqual({ found: true, text: "# unknown-hook-option\n" });
    expect(explainPage("RMD02")).toMatchObject({ found: false, meant: ["RMD020"] });
  });

  /**
   * Found by review: a page's path was joined to the docs folder as written, so `../` walked out of
   * it — and through the MCP server an agent chooses that path, from whatever it last read.
   */
  test("a path that leaves the docs folder reads nothing outside it", () => {
    packed();
    const docs = process.env.RAMONDA_CHECK_DOCS as string;
    writeFileSync(join(dirname(docs), "outside.md"), "# not a page\n");
    try {
      const name = `../outside`;
      expect(docsPage(name).found).toBe(false);
      expect(explainPage(`../../outside`).found).toBe(false);
    } finally {
      rmSync(join(dirname(docs), "outside.md"), { force: true });
    }
  });

  test("with no docs packed, it says so and where the page is online", () => {
    process.env.RAMONDA_CHECK_DOCS = join(tmpdir(), "no-such-docs-folder");
    expect(docsPage("forms/fields")).toMatchObject({ found: false, online: "https://ramonda.dev/forms/fields" });
  });
});
