import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { checkProject } from "../adapters/check";
import { cssReport } from "../adapters/report";

/**
 * The check over code that is not saved yet — for the MCP server's `check_code`, where an agent asks
 * about a file before it writes it. The files are laid over the disk for one run; nothing is written.
 */
const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JSX = `declare namespace JSX {\n  interface IntrinsicElements { div: { id?: string; className?: string; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`;
const CLEAN = `const a = <div className={@@(\n  position: static;\n)}>x</div>;\nexport default a;\n`;
const BLOCK_FAULT = `const a = <div className={@@(\n  position: statik;\n)}>x</div>;\nexport default a;\n`;
const TYPE_FAULT = `export const n: number = "seven";\n`;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function project(): { root: string; tsconfig: string } {
  const root = mkdtempSync(join(tmpdir(), "css-memory-"));
  roots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "jsx.d.ts"), JSX);
  writeFileSync(join(root, "src", "Card.tsx"), CLEAN);
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "preserve",
        types: [],
        skipLibCheck: true,
        paths: { "@ramonda/css/properties": [join(PACKAGE, "src", "properties.ts")] },
      },
      include: ["src"],
    }),
  );
  return { root, tsconfig: join(root, "tsconfig.json") };
}

const where = (findings: readonly { file: string; line: number; code: number | string }[]) =>
  findings.map((one) => `${one.file.split("/").pop()}:${one.line}:${one.code}`);

describe("checkProject over files in memory", () => {
  test("a file on disk is read from memory instead, and the disk is left alone", () => {
    const { root, tsconfig } = project();
    const card = join(root, "src", "Card.tsx");
    expect(checkProject(tsconfig).findings).toEqual([]);
    expect(where(checkProject(tsconfig, { files: { [card]: BLOCK_FAULT } }).findings)).toEqual(["Card.tsx:2:2820"]);
    expect(readFileSync(card, "utf8")).toBe(CLEAN);
  });

  test("a file no disk holds joins the project, block or no block", () => {
    const { root, tsconfig } = project();
    const files = { [join(root, "src", "New.tsx")]: BLOCK_FAULT, [join(root, "src", "count.ts")]: TYPE_FAULT };
    expect(where(checkProject(tsconfig, { files }).findings).sort()).toEqual(["New.tsx:2:2820", "count.ts:1:2322"]);
  });
});

/**
 * One file's type check, for `check_code`. The whole program's took 6.1 s on the docs app, every time
 * an agent asked about one file; the compiler can check a single file of a program.
 */
describe("only", () => {
  test("type-checks the files it names and leaves the rest unread", () => {
    const { root, tsconfig } = project();
    writeFileSync(join(root, "src", "broken.ts"), TYPE_FAULT);
    const card = join(root, "src", "Card.tsx");
    expect(where(checkProject(tsconfig, { files: { [card]: BLOCK_FAULT } }).findings).sort()).toEqual([
      "Card.tsx:2:2820",
      "broken.ts:1:2322",
    ]);
    expect(where(checkProject(tsconfig, { files: { [card]: BLOCK_FAULT }, only: [card] }).findings)).toEqual([
      "Card.tsx:2:2820",
    ]);
  });
});

describe("cssReport", () => {
  test("is the object `ramonda-css --json` prints", () => {
    const { root, tsconfig } = project();
    writeFileSync(join(root, "src", "Card.tsx"), BLOCK_FAULT);
    const cli = spawnSync(process.execPath, [join(PACKAGE, "bin.mjs"), tsconfig, "--json"], { encoding: "utf8" });
    expect(JSON.parse(JSON.stringify(cssReport(tsconfig)))).toEqual(JSON.parse(cli.stdout));
  });

  test("names a type error the way the command does", () => {
    const { root, tsconfig } = project();
    const report = cssReport(tsconfig, { files: { [join(root, "src", "count.ts")]: TYPE_FAULT } });
    expect(report.ok).toBe(false);
    expect(report.findings.map((one) => one.code)).toEqual(["TS2322"]);
  });
});
