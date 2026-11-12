// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * The server as an agent meets it: the shipped launcher, started over stdio in the app's folder, and
 * asked through the protocol's own client. Nothing here calls `createServer` directly — a server that
 * works in-process and not from `ramonda-mcp` would pass a test that skipped the launcher.
 */
const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "fixtures", "app");
const bin = join(here, "..", "..", "bin.mjs");

const HELPER = `import { Component } from "@ramonda/core";

export class Draft extends Component {
  render() {
    const head = (key: string) => <th>{key}</th>;
    return <tr>{head("a")}{head("b")}</tr>;
  }
}
`;
const CLEAN = `import { Component } from "@ramonda/core";

export class Draft extends Component {
  render() {
    return <p>draft</p>;
  }
}
`;

let docs: string;
let client: Client;

beforeAll(async () => {
  docs = mkdtempSync(join(tmpdir(), "mcp-docs-"));
  const pages: Record<string, string> = {
    "llms.txt": "# Ramonda\n\n> The index.\n",
    "forms/fields.md": "# Fields\n",
    "reference/diagnostics/rmd020.md": "# RMD020 — rendered twice\n",
  };
  for (const [file, text] of Object.entries(pages)) {
    mkdirSync(dirname(join(docs, file)), { recursive: true });
    writeFileSync(join(docs, file), text);
  }
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [bin],
      cwd: app,
      env: { ...getDefaultEnvironment(), RAMONDA_CHECK_DOCS: docs },
      stderr: "pipe",
    }),
  );
});

afterAll(async () => {
  await client.close();
  rmSync(docs, { recursive: true, force: true });
});

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[]).map((one) => one.text).join("");
const report = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse(text(result)) as { ok: boolean; findings: { code: string; line?: number; file?: string }[] };

describe("ramonda-mcp", () => {
  test("offers the four tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["check_code", "check_project", "docs", "explain"]);
  });

  test("check_code reports what is wrong in a file that is not saved, and writes nothing", async () => {
    const result = report(
      await client.callTool({ name: "check_code", arguments: { path: "Draft.tsx", code: HELPER } }),
    );
    expect(result.ok).toBe(false);
    expect(result.findings.map((one) => `${one.code}:${one.line}`)).toEqual(["markup-helper-in-render:5"]);
    expect(readdirSync(app)).not.toContain("Draft.tsx");
  });

  test("check_code on correct code is ok and finds nothing", async () => {
    const result = report(await client.callTool({ name: "check_code", arguments: { path: "Draft.tsx", code: CLEAN } }));
    expect(result).toMatchObject({ ok: true, findings: [] });
  });

  test("check_project is the app's own verdict", async () => {
    const result = report(await client.callTool({ name: "check_project", arguments: {} }));
    expect(result).toMatchObject({ tool: "ramonda-check", ok: true, findings: [] });
  });

  test("docs and explain read the installed version's pages, and name what a slip meant", async () => {
    expect(text(await client.callTool({ name: "docs", arguments: {} }))).toBe("# Ramonda\n\n> The index.\n");
    expect(text(await client.callTool({ name: "docs", arguments: { page: "forms/fields" } }))).toBe("# Fields\n");
    expect(text(await client.callTool({ name: "explain", arguments: { code: "RMD020" } }))).toBe(
      "# RMD020 — rendered twice\n",
    );
    const slip = await client.callTool({ name: "docs", arguments: { page: "forms/feilds" } });
    expect(slip.isError).toBe(true);
    expect(text(slip)).toContain("Did you mean forms/fields?");
  });

  test("a tsconfig that is not there is an error that says what to pass", async () => {
    const missing = await client.callTool({ name: "check_project", arguments: { tsconfig: "nope/tsconfig.json" } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain("No tsconfig at");
  });
});
