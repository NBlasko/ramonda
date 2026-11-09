import { printWhole } from "./print";

/**
 * What `--json` prints: one object on stdout, for a program — a coding agent above all — that would
 * otherwise parse the prose.
 *
 * The same shape from `ramonda-check`, `ramonda-check-bundle` and `ramonda-css`, so a reader of one
 * reads all three. The exit code is the one the text run gives; `ok` says the same, for a reader
 * that only has the output.
 *
 * `message` is the text the run prints for that finding, without its location and indentation;
 * `data` is everything the finding knows, as the rule recorded it. `code` is the rule's id, or for
 * a fault computed from the whole graph, the id that section carries.
 */
export interface JsonFinding {
  code: string;
  severity: "error" | "warn";
  file?: string;
  line?: number;
  column?: number;
  message: string;
  data?: unknown;
}

export interface JsonReport {
  tool: string;
  version: string;
  ok: boolean;
  findings: JsonFinding[];
  /** What the run had to say about itself — a package it could not read, a fragment it refused. */
  notes: string[];
  [more: string]: unknown;
}

/** The lines a finding prints, as one message: the location dropped, the indentation taken off. */
export function messageOf(lines: readonly string[], at?: { file?: string; line?: number; column?: number }): string {
  const location = at?.file === undefined ? undefined : `${at.file}:${at.line}:${at.column}`;
  return lines
    .map((line) => line.trim())
    .filter((line, index) => !(index === 0 && line === location))
    .join("\n")
    .trim();
}

/** Where a finding is, if it says. */
export function locationOf(item: unknown): { file?: string; line?: number; column?: number } {
  if (typeof item !== "object" || item === null) return {};
  const { file, line, column } = item as Record<string, unknown>;
  return typeof file === "string" && typeof line === "number" && typeof column === "number"
    ? { file, line, column }
    : {};
}

/** The report, as the one line a reader parses. */
export function printJson(report: JsonReport): void {
  printWhole(`${JSON.stringify(report)}\n`);
}
