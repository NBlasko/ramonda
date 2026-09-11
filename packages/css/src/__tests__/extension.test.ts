import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterEach, describe, expect, test } from "vitest";
import { builtFromThisSource } from "./built";

/** This file runs the BUILD, so a stale `dist` would measure a previous version — see `built.ts`. */
beforeAll(builtFromThisSource);

/**
 * The editor extension, which is PUBLISHED and had no test of any kind.
 *
 * `formatter.js` needs `vscode` to be loadable, so it cannot be imported here — and that is exactly
 * why `locate.js` is its own file: the decision is in there, and everything around it is wiring.
 * What the wiring does is measured through the command it shells out to, which is this package's own
 * bin and is testable.
 */
const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(PACKAGE, "bin.mjs");
const { commandFor } = createRequire(join(PACKAGE, "package.json"))("./vscode/locate.js") as {
  commandFor: (file: string) => string | undefined;
};

const rooms: string[] = [];
afterEach(() => {
  for (const one of rooms.splice(0)) rmSync(one, { recursive: true, force: true });
});

/** A project with its own `ramonda-css`, and a dependency that has one too. */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), "ramonda-css-vscode-"));
  rooms.push(root);
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".bin", "ramonda-css"), "#!/bin/sh\n");
  mkdirSync(join(root, "src", "deep"), { recursive: true });
  return root;
}

describe("which `ramonda-css` a file gets", () => {
  test("the project's own, from anywhere inside it", () => {
    const root = project();
    const its = join(root, "node_modules", ".bin", "ramonda-css");

    expect(commandFor(join(root, "src", "Card.tsx"))).toBe(its);
    expect(commandFor(join(root, "src", "deep", "Card.tsx"))).toBe(its);
  });

  /**
   * The spelling a WINDOWS install writes — see `toolIn`, which had the same gap and was found with
   * it. Not measured on Windows, because there is none here and CI runs `ubuntu-latest` for every
   * job; the lookup is what is measured.
   */
  test.each([".cmd", ".exe", ".ps1"])("the %s a Windows install writes", (extension) => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-css-vscode-"));
    rooms.push(root);
    const bin = join(root, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, `ramonda-css${extension}`), "");
    mkdirSync(join(root, "src"), { recursive: true });

    expect(commandFor(join(root, "src", "Card.tsx"))).toBe(join(bin, `ramonda-css${extension}`));
  });

  /**
   * A file with no project above it gets nothing, and that is not an error: a file outside a project
   * that installed the package is not this extension's to format, and complaining on every save of
   * every file would be worse than doing nothing.
   */
  test("and nothing at all outside a project", () => {
    expect(commandFor(join(tmpdir(), "ramonda-css-nowhere", "Card.tsx"))).toBeUndefined();
  });
});

/**
 * **THE ANSWER COMES BACK WHOLE**, and it did not.
 *
 * The extension replaces the WHOLE DOCUMENT with what the command hands back:
 *
 *     return formatted === text ? [] : [vscode.TextEdit.replace(everything(document), formatted)];
 *
 * So anything the command drops is text deleted from the author's file, on save, with no error. And
 * `--stdin-file-path` dropped everything past 64KB — a pipe's worth — because the answer went to
 * `process.stdout.write` and the process then called `process.exit`, which does not drain one.
 *
 * Measured on a 132,780-byte file: biome answered with all of it and this handed back 65,536 bytes,
 * cut mid-line. `cli.test.ts` stands over the command; this stands over the claim the extension
 * makes about it, which is the one that costs somebody their work.
 */
describe("what the extension would write into the document", () => {
  test("the formatted text is the whole file, however big it is", () => {
    const lines = 5000;
    const text = `${Array.from({ length: lines }, (_, index) => `export const n${index} = ${index};`).join("\n")}\n`;

    // From the PACKAGE: the wrapper walks up for the project's own biome, and a temp folder has none.
    const formatted = execFileSync(process.execPath, [BIN, "format", "--stdin-file-path=src/Big.tsx"], {
      cwd: PACKAGE,
      input: text,
      encoding: "utf8",
    });

    expect(text.length).toBeGreaterThan(65536);
    expect(formatted).toContain(`export const n${lines - 1} = ${lines - 1};`);
    // What the extension compares, and what it would replace the document with.
    expect(formatted.length).toBeGreaterThanOrEqual(text.length);
  });
});
