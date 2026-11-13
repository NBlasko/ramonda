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

  /**
   * What the app's BUILD reports, not only what `ramonda-check` does: a generated project's build runs
   * `tsc --noEmit` after it, so a file that does not compile passed `check_code` while the build failed.
   */
  test("check_code reports a type error the way the build's type check does", async () => {
    const result = report(
      await client.callTool({
        name: "check_code",
        arguments: { path: "count.ts", code: 'export const n: number = "seven";\n' },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.findings.map((one) => `${one.code}:${one.line}`)).toEqual(["TS2322:1"]);
  });

  /**
   * An app with style blocks type-checks through `ramonda-css`, which reads the blocks `tsc` cannot,
   * and runs the CSS rules — so `check_code` asks the APP's own copy, as its build does.
   */
  test("in an app with style blocks, check_code asks the app's own ramonda-css", async () => {
    const card = (value: string) =>
      `const card = <div className={@@(\n  position: ${value};\n)}>card</div>;\nexport default card;\n`;
    const ask = async (value: string) =>
      report(
        await client.callTool({
          name: "check_code",
          arguments: { tsconfig: "../styled/tsconfig.json", path: "../styled/Card.tsx", code: card(value) },
        }),
      );
    expect(await ask("static")).toMatchObject({ ok: true, findings: [] });
    const faulty = await ask("statik");
    expect(faulty.ok).toBe(false);
    expect(faulty.findings.map((one) => `${one.code}:${one.line}`)).toEqual(["TS2820:2"]);
  });

  /** A check that could not run must not read as one that passed. */
  test("an app naming @ramonda/css with none installed is told its types were not checked", async () => {
    const away = mkdtempSync(join(tmpdir(), "mcp-no-css-"));
    try {
      writeFileSync(
        join(away, "package.json"),
        JSON.stringify({ name: "away", dependencies: { "@ramonda/css": "*" } }),
      );
      writeFileSync(join(away, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true }, include: ["."] }));
      const result = report(
        await client.callTool({
          name: "check_code",
          arguments: { tsconfig: join(away, "tsconfig.json"), path: join(away, "a.ts"), code: "export {};\n" },
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.findings.map((one) => one.code)).toEqual(["type-check-not-run"]);
    } finally {
      rmSync(away, { recursive: true, force: true });
    }
  });

  /**
   * Found by review: asked about one file, the answer kept only findings IN that file, and a type
   * check that fails for the whole project — a `types` entry that is not installed — has none. The
   * build stopped on it, and `check_code` said ok.
   */
  test("check_code keeps an error that belongs to no file — the build stops on it too", async () => {
    const away = mkdtempSync(join(tmpdir(), "mcp-global-"));
    try {
      writeFileSync(join(away, "package.json"), JSON.stringify({ name: "away" }));
      writeFileSync(
        join(away, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { noEmit: true, types: ["not-a-package"] }, include: ["."] }),
      );
      writeFileSync(join(away, "b.ts"), "export const b = 1;\n");
      const result = report(
        await client.callTool({
          name: "check_code",
          arguments: { tsconfig: join(away, "tsconfig.json"), path: join(away, "a.ts"), code: "export {};\n" },
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.findings.map((one) => one.code)).toContain("TS2688");
    } finally {
      rmSync(away, { recursive: true, force: true });
    }
  });

  test("check_project is the app's own verdict", async () => {
    const result = report(await client.callTool({ name: "check_project", arguments: {} }));
    expect(result).toMatchObject({ tool: "ramonda-mcp", ok: true, findings: [] });
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
