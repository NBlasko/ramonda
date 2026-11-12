import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * `ramonda-check --json`: the same run, as one object a program parses instead of the prose.
 *
 * Found by an agent building an app from the docs alone, which read every report by matching text.
 * Run through the shipped launcher, as a reader runs it.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const fixture = (name: string) => join(here, "fixtures", name, "tsconfig.json");
const run = (...args: string[]) => {
  const result = spawnSync(process.execPath, [join(root, "bin.mjs"), ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

interface Finding {
  code: string;
  severity: string;
  file?: string;
  line?: number;
  column?: number;
  message: string;
  data?: Record<string, unknown>;
}
const parsed = (stdout: string) => JSON.parse(stdout) as { tool: string; ok: boolean; findings: Finding[] };

describe("ramonda-check --json", () => {
  test("a clean project: ok, nothing found, exit 0, and stdout is the object alone", () => {
    const { status, stdout } = run(fixture("ok"), "--json");
    expect(status).toBe(0);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    const report = parsed(stdout);
    expect(report).toMatchObject({ tool: "ramonda-check", ok: true, findings: [] });
  });

  test("a rule's finding carries its code, where it is, what the run says, and what it knows", () => {
    const { status, stdout } = run(fixture("unknown-hook-option"), "--json");
    expect(status).toBe(1);
    const report = parsed(stdout);
    expect(report.ok).toBe(false);
    const typo = report.findings.find((finding) => finding.data?.option === "staleTimee");
    expect(typo).toMatchObject({ code: "unknown-hook-option", severity: "error" });
    expect(typo?.file).toMatch(/app\.tsx$/);
    expect(typo?.line).toBeGreaterThan(0);
    expect(typo?.message).toBe(
      "<Reported> gives Fetching `staleTimee`, and Fetching has no such option: did you mean `staleTime`?",
    );
  });

  test("a fault computed from the whole graph is a finding too", () => {
    const { status, stdout } = run(fixture("missing"), "--json");
    expect(status).toBe(1);
    const missing = parsed(stdout).findings.filter((finding) => finding.code === "missing-provider");
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0].message).toMatch(/consumes ".+" — nothing provides it on this path:/);
  });

  /** One reader for both, so the JSON cannot report a finding the text does not, or miss one it does. */
  test("reports every place the text run reports, and no other", () => {
    for (const name of ["unknown-hook-option", "missing", "ok"]) {
      const json = parsed(run(fixture(name), "--json").stdout);
      const text = run(fixture(name)).stderr;
      const textPlaces = [...text.matchAll(/^ {2}(\/\S+:\d+:\d+)$/gm)].map((match) => match[1]).sort();
      const jsonPlaces = json.findings.map((finding) => `${finding.file}:${finding.line}:${finding.column}`).sort();
      if (name !== "ok") expect(textPlaces.length, name).toBeGreaterThan(0);
      expect(jsonPlaces, name).toEqual(textPlaces);
    }
  });

  test("refuses a report it has no JSON form for", () => {
    for (const flag of ["--fix", "--split", "--certify"]) {
      const { status, stdout, stderr } = run(fixture("ok"), "--json", flag);
      expect(status, flag).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toContain("--json reports a plain run");
    }
  });
});

describe("ramonda-check-bundle --json", () => {
  const bundle = (...args: string[]) => {
    const result = spawnSync(process.execPath, [join(root, "check-bundle.mjs"), ...args], { encoding: "utf8" });
    return { status: result.status, stdout: result.stdout };
  };
  const dir = () => {
    const at = mkdtempSync(join(tmpdir(), "check-bundle-json-"));
    scratch.push(at);
    return at;
  };

  test("a file that does not parse is a finding, in the shape ramonda-check prints", () => {
    const at = dir();
    writeFileSync(join(at, "ok.js"), "export const a = 1;\n");
    writeFileSync(join(at, "bad.js"), "@dec class A {}\n");
    const { status, stdout } = bundle(at, "--json");
    expect(status).toBe(1);
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({ tool: "ramonda-check-bundle", ok: false, files: 2 });
    expect(report.findings).toEqual([
      {
        code: "unparseable-bundle",
        severity: "error",
        file: join(at, "bad.js"),
        message: expect.stringMatching(/^SyntaxError/),
      },
    ]);
  });

  test("every file parses: ok, and exit 0", () => {
    const at = dir();
    writeFileSync(join(at, "ok.js"), "export const a = 1;\n");
    const { status, stdout } = bundle(at, "--json");
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, findings: [], files: 1 });
  });
});
