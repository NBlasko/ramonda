import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CheckOptions, checkProject, type Report } from "./check";

/** One finding as `--json` prints it — the shape `ramonda-check --json` prints too. */
export interface JsonFinding {
  code: string;
  severity: "error";
  file: string;
  line?: number;
  column?: number;
  message: string;
}

/** What `ramonda-css --json` prints for a check. */
export interface CssJsonReport {
  tool: "ramonda-css";
  version: string;
  ok: boolean;
  findings: JsonFinding[];
  notes: string[];
  files: number;
  styled: number;
  ignored: { file: string; line: number; reason: string }[];
}

/** This package's version, from its own `package.json` — found by walking up, so source and build agree. */
export function version(): string {
  for (let at = dirname(fileURLToPath(import.meta.url)); dirname(at) !== at; at = dirname(at)) {
    const file = join(at, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version: string };
    if (pkg.name === "@ramonda/css") return pkg.version;
  }
  return "unknown";
}

/** A TypeScript code is a number, written `TS2322`; a rule's id is already a word. */
const codeOf = (code: number | string): string => (typeof code === "number" ? `TS${code}` : code);

/**
 * A check's report as the object `--json` prints — the CLI's own builder, so a program that runs the
 * check itself is told what the command says. The MCP server is that program.
 */
export function jsonOf(report: Report): CssJsonReport {
  const findings = report.findings.map((finding) => ({
    // A block that could not be read is code 0, and the text run calls it a refusal.
    code: report.refusals.includes(finding) ? "unreadable-block" : codeOf(finding.code),
    severity: "error" as const,
    file: finding.file,
    line: finding.line,
    column: finding.column,
    message: report.refusals.includes(finding) ? finding.message.replace(/^.*?:\d+:\d+\s+/, "") : finding.message,
  }));
  return {
    tool: "ramonda-css",
    version: version(),
    ok: findings.length === 0,
    findings,
    notes: [],
    files: report.files,
    styled: report.styled,
    ignored: report.exempted.map((one) => ({ file: one.file, line: one.line, reason: one.reason })),
  };
}

/**
 * The check `ramonda-css` runs — the project type-checked with its style blocks read, and the CSS
 * rules — as the object `--json` prints. `files` checks code that is not saved yet; see `CheckOptions`.
 */
export function cssReport(tsconfig: string, options: CheckOptions = {}): CssJsonReport {
  return jsonOf(checkProject(tsconfig, options));
}
