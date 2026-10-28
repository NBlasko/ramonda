import ts from "typescript";
import { describe, expect, test } from "vitest";
import { domStub } from "../domStub";

const FILE = "/stub.d.ts";

/** The stand-ins alone, with the language's own lib: what TypeScript says about them. */
function diagnostics(): readonly ts.Diagnostic[] {
  const host = ts.createCompilerHost({});
  const source = host.getSourceFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.getSourceFile = (file, language, onError, create) =>
    file === FILE ? ts.createSourceFile(file, domStub(), language, true) : source(file, language, onError, create);
  host.fileExists = (file) => file === FILE || exists(file);
  const program = ts.createProgram({
    rootNames: [FILE],
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
      /^interface HTMLInputElement extends HTMLElement, PopoverTargetAttributes \{ readonly "stub:HTMLInputElement": never; \}$/m,
    );
    expect(stub).toMatch(
      /^interface HTMLFormElement extends HTMLElement \{ readonly "stub:HTMLFormElement": never; reset\(\): void; \}$/m,
    );
    expect(stub).toMatch(/^interface CustomEvent<T0 = any> extends Event \{/m);
    expect(stub).toMatch(/^interface ReadableWritablePair<T0 = any, T1 = any> \{/m);
    expect(stub).toMatch(/^declare var document: Document;$/m);
    expect(stub).toMatch(/^declare function setInterval\(/m);
  });
});
