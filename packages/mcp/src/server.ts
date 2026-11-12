import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { analyzeProject, type DocsAnswer, docsPage, explainPage, type JsonReport, reportOf } from "@ramonda/check";
import * as z from "zod/v4";

/** Where the server is asked about: the app's folder, which the client starts it in. */
export interface ServerOptions {
  /** The folder the app is in. Default: the folder the server was started in. */
  cwd?: string;
  /** The server's own version, as the client is told it. */
  version?: string;
}

/**
 * The server: four tools over the checker and the docs of the version that is installed.
 *
 * It adds no rule and no page of its own. `check_code` and `check_project` answer with the object
 * `ramonda-check --json` prints, built by the same function; `docs` and `explain` with the pages
 * `ramonda-check docs` and `explain` print. What an agent is told here is what the app's build will
 * say — a second reading of either would be the place the two could disagree.
 *
 * It writes nothing and runs nothing of the app's. Every tool only reads.
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const cwd = options.cwd ?? process.cwd();
  const server = new McpServer({ name: "ramonda", version: options.version ?? "0.0.0" });

  server.registerTool(
    "check_code",
    {
      description:
        "Check a file of a Ramonda app BEFORE writing it: the app's own checker reads the code as if it were " +
        "saved at `path`, together with the rest of the project, and reports what is wrong in that file. " +
        "Run it on every file you write or change, and fix what it reports before showing the code. " +
        "Nothing is written to disk.",
      inputSchema: z.object({
        path: z.string().describe("Where the file is or will be, relative to the app's folder or absolute."),
        code: z.string().describe("The whole file, as it would be saved."),
        tsconfig: z.string().optional().describe("The tsconfig to read the project with. Default: tsconfig.json."),
      }),
    },
    async ({ path, code, tsconfig }) => {
      const project = tsconfigAt(cwd, tsconfig);
      if (typeof project !== "string") return project;
      const file = resolve(cwd, path);
      const report = reportOf(analyzeProject(project, { files: { [file]: code } }));
      const mine = report.findings.filter((finding) => finding.file !== undefined && same(finding.file, file));
      return answer({ ...report, ok: !mine.some((finding) => finding.severity === "error"), findings: mine });
    },
  );

  server.registerTool(
    "check_project",
    {
      description:
        "Check the whole Ramonda app with its own checker — the same findings `ramonda-check` reports, and the " +
        "same verdict the app's build will reach.",
      inputSchema: z.object({
        tsconfig: z.string().optional().describe("The tsconfig to read the project with. Default: tsconfig.json."),
      }),
    },
    async ({ tsconfig }) => {
      const project = tsconfigAt(cwd, tsconfig);
      if (typeof project !== "string") return project;
      return answer(reportOf(analyzeProject(project)));
    },
  );

  server.registerTool(
    "docs",
    {
      description:
        "Read a page of the Ramonda docs for the version this app has installed — not the latest release. " +
        "With no page, the index of every page. A page is its path on ramonda.dev: `forms/fields`, `routing/links`.",
      inputSchema: z.object({
        page: z.string().optional().describe("The page's path, e.g. `forms/fields`. Omit for the index."),
      }),
    },
    async ({ page }) => read(docsPage(page)),
  );

  server.registerTool(
    "explain",
    {
      description:
        "Explain a Ramonda diagnostic code (`RMD020`, `RMQ001`) or a checker rule (`unknown-hook-option`): " +
        "what it means and what to write instead, for the version this app has installed.",
      inputSchema: z.object({
        code: z.string().describe("A diagnostic code or a rule id, as a report printed it."),
      }),
    },
    async ({ code }) => read(explainPage(code)),
  );

  return server;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** A report, as the one JSON object `--json` prints — an agent parses it, and a person can read it. */
function answer(report: JsonReport): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(report) }] };
}

/** A page, or why there is none — as an error result, so an agent does not take the message for a page. */
function read(page: DocsAnswer): ToolResult {
  if (page.found) return { content: [{ type: "text", text: page.text }] };
  return { content: [{ type: "text", text: page.message }], isError: true };
}

/** The tsconfig a tool reads, or the error result that says why there is none. */
function tsconfigAt(cwd: string, asked: string | undefined): string | ToolResult {
  const given = resolve(cwd, asked ?? "tsconfig.json");
  const file = statSync(given, { throwIfNoEntry: false })?.isDirectory() ? join(given, "tsconfig.json") : given;
  if (existsSync(file)) return file;
  return {
    content: [
      {
        type: "text",
        text:
          `No tsconfig at ${file}. Start the server in the app's folder, or name one: ` +
          `{ "tsconfig": "${isAbsolute(asked ?? "") ? asked : "apps/web/tsconfig.json"}" }.`,
      },
    ],
    isError: true,
  };
}

/** Two absolute paths naming one file, whichever separator each was written with. */
function same(one: string, other: string): boolean {
  const spelled = (path: string) => resolve(path).split(sep).join("/");
  return spelled(one) === spelled(other);
}
