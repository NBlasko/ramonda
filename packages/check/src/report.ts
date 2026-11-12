import { readFileSync } from "node:fs";
import type { AnalyzeResult } from "./analyze";
import { type AnyGraphReport, GRAPH_REPORTS } from "./graphReports";
import { type JsonFinding, type JsonReport, locationOf, messageOf } from "./jsonReport";
import { RULES } from "./rules";

/**
 * A run's result as the report `--json` prints — the CLI's own builder, exported so a program that
 * runs the analysis itself gets the same object rather than a second reading of the findings.
 *
 * The MCP server is that program. Built twice, the two would drift the first time a rule's message
 * changed, and an agent would be told one thing by the tool and another by the build.
 */
export function reportOf(result: AnalyzeResult): JsonReport {
  const own = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const found: JsonFinding[] = [];
  for (const graphReport of GRAPH_REPORTS as readonly AnyGraphReport[]) {
    for (const item of graphReport.items(result)) {
      const at = locationOf(item);
      found.push({
        code: graphReport.id,
        severity: "error",
        ...at,
        message: messageOf(graphReport.lines(item)),
        data: item,
      });
    }
  }
  for (const rule of RULES) {
    for (const issue of result.findings[rule.id]) {
      const at = locationOf(issue);
      found.push({
        code: rule.id,
        severity: rule.report.severity,
        ...at,
        message: messageOf(rule.report.lines(issue as never), at),
        data: issue,
      });
    }
  }
  return {
    tool: "ramonda-check",
    version: own.version,
    ok: !found.some((finding) => finding.severity === "error"),
    findings: found,
    notes: result.notes,
    ignored: result.annotated,
    counts: result.counts,
  };
}
