import ts from "typescript";
import { describe, expect, test } from "vitest";
import { domStub } from "../domStub";
import { createProgram } from "../analyze";
import { DOM_STUB_FILE } from "../rules/platform";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = "/stub.d.ts";
const USE = "/use.ts";

/** The stand-ins, and code that uses them, with the language's own lib: what TypeScript says about them. */
function diagnostics(use = ""): readonly ts.Diagnostic[] {
  const host = ts.createCompilerHost({});
  const source = host.getSourceFile.bind(host);
  const exists = host.fileExists.bind(host);
  const written = new Map([
    [FILE, domStub()],
    [USE, use],
  ]);
  host.getSourceFile = (file, language, onError, create) => {
    const text = written.get(file);
    return text !== undefined
      ? ts.createSourceFile(file, text, language, true)
      : source(file, language, onError, create);
  };
  host.fileExists = (file) => written.has(file) || exists(file);
  const program = ts.createProgram({
    rootNames: [FILE, USE],
    options: { lib: ["lib.esnext.d.ts"], types: [], noEmit: true, strict: true },
    host,
  });
  return ts.getPreEmitDiagnostics(program);
}

/**
 * The DOM's names as stand-ins, read from the DOM lib of the TypeScript this package runs. Core's and
 * the form's declarations are read against them — the end-to-end test is the form's
 * `TheCheckReadsTheFormsTypes`, on the built types.
 */
describe("the DOM's stand-ins", () => {
  test("are a well-formed declaration file beside the language's lib", () => {
    expect(diagnostics().map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))).toEqual([]);
  });

  test("keep each name distinct, the DOM interfaces it extends, and the arity of a generic one", () => {
    const stub = domStub();
    expect(stub).toMatch(
      /^interface HTMLInputElement extends HTMLElement, PopoverTargetAttributes \{ readonly "stub:HTMLInputElement": never \}$/m,
    );
    expect(stub).toMatch(/^interface CustomEvent<T0 = any> extends Event \{/m);
    expect(stub).toMatch(/^interface ReadableWritablePair<T0 = any, T1 = any> \{/m);
    expect(stub).toMatch(/^declare var document: Document;$/m);
    expect(stub).toMatch(
      /^declare var HTMLFormElement: \{ prototype: HTMLFormElement; new \(\.\.\.args: any\[\]\): HTMLFormElement \};$/m,
    );
    expect(stub).toMatch(/^declare function setInterval\(/m);
  });

  test("keep a form's members, its own and every base's, so TypeScript says what a form fits", () => {
    const fits = [
      "{ reset(): void; submit(): void }",
      "{ elements: HTMLFormControlsCollection; action: string }",
      "{ focus(): void; addEventListener: Function }",
      "{ onclick: ((event: PointerEvent) => any) | null }",
      "HTMLElement",
      "Record<string, unknown>",
    ];
    const fitsNot = [
      "{ reset?: boolean }",
      "{ reset: boolean }",
      "{ debounce?: number }",
      "{ length: () => number }",
      "{ getContext(): void }",
      "HTMLInputElement",
    ];
    const use = [...fits, ...fitsNot]
      .map((type, at) => `export const held${at}: ${type} = null as unknown as HTMLFormElement;`)
      .join("\n");
    const refused = diagnostics(use)
      .filter((d) => d.file?.fileName === USE)
      .map((d) => d.file!.getLineAndCharacterOfPosition(d.start!).line);
    expect([...fits, ...fitsNot].filter((_, at) => refused.includes(at))).toEqual(fitsNot);
  });

  test("are parsed once, and shared by every program after", () => {
    const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "dom-reference", "tsconfig.json");
    const stub = (program: ts.Program) => program.getSourceFiles().find((file) => file.fileName === DOM_STUB_FILE);
    const first = stub(createProgram(fixture).program);
    expect(first).toBeDefined();
    expect(stub(createProgram(fixture).program)).toBe(first);
  });

  /** A file that asks for the DOM lib itself — `/// <reference lib="dom" />` — gets nothing: the stand-ins are the DOM. */
  test("are the only DOM, where a project's file asks for the DOM lib", () => {
    const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "dom-reference", "tsconfig.json");
    const { program } = createProgram(fixture);
    const domLibs = program.getSourceFiles().filter((file) => /[\\/]lib\.dom(\.[a-z]+)?\.d\.ts$/.test(file.fileName));
    expect(domLibs.length).toBeGreaterThan(0);
    expect(domLibs.map((file) => file.text)).toEqual(domLibs.map(() => ""));
  });
});
