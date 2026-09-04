import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { virtualFile } from "../compiler/virtual";
import { init } from "../plugin";

/**
 * The language service plugin, driven the way an editor drives one: a real `ts.LanguageService`, the
 * plugin's own proxy over it, and every question asked at a position in the AUTHOR's file.
 *
 * This is the half that decides whether the feature is usable. A type nobody meets until CI is a
 * type nobody writes against, so the assertions are about what an editor shows: the property names
 * while a name is being typed, the value union while a value is, a hover, and — the loud one — that
 * a correct block gets no red squiggle even though the file does not parse as TypeScript.
 */

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = join(PACKAGE, "src", "__tests__", "Card.tsx");
const JSX_FILE = join(PACKAGE, "src", "__tests__", "jsx.d.ts");

const JSX_TYPES = `
declare namespace JSX {
  interface IntrinsicElements {
    div: { className?: string; css?: unknown; children?: unknown };
  }
  interface Element { readonly _brand: unique symbol }
}
`;

/** The caret, marked in the source so a test never counts characters. */
const CARET = "/*|*/";

/**
 * A language service over one file, with the plugin's proxy in front of it — which is exactly the
 * arrangement `tsserver` builds.
 */
function editor(marked: string, config: { properties?: string } = { properties: join(PACKAGE, "src", "properties") }) {
  const source = marked.replace(CARET, "");
  const caret = marked.indexOf(CARET);

  const files: Record<string, string> = { [FILE]: source, [JSX_FILE]: JSX_TYPES };

  /**
   * A host, built fresh each time it is asked for.
   *
   * Two are needed and they cannot be one: the plugin patches the host it is given IN PLACE, so a
   * control sharing it would be measuring the plugin. Spreading the patched one does not help — the
   * patched method comes with it — and taking the control BEFORE builds a program from the author's
   * text that the version never invalidates, so every later answer comes from a stale one. Measured,
   * as a thousand global-scope completions where the property names belong.
   */
  const makeHost = (): ts.LanguageServiceHost => ({
    getScriptFileNames: () => [FILE, JSX_FILE],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const text = files[name] ?? ts.sys.readFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => PACKAGE,
    getCompilationSettings: () => ({
      jsx: ts.JsxEmit.Preserve,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      types: [],
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    }),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (name) => files[name] !== undefined || ts.sys.fileExists(name),
    readFile: (name) => files[name] ?? ts.sys.readFile(name),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  });

  const host = makeHost();

  const plain = ts.createLanguageService(host);
  const service = init({ typescript: ts }).create({ languageService: plain, languageServiceHost: host, config });

  /** What a service with no plugin at all says — see `makeHost` for why it needs its own. */
  const withoutThePlugin = () => ts.createLanguageService(makeHost()).getSyntacticDiagnostics(FILE);

  /**
   * The same questions asked of the virtual file with NOTHING mapped back — the control for every
   * test that asserts a diagnostic was dropped. An empty list is what a broken plugin returns too.
   */
  const unmapped = () => {
    const proxyHost: ts.LanguageServiceHost = Object.create(host);
    proxyHost.getScriptSnapshot = (name) => {
      if (name !== FILE) return host.getScriptSnapshot(name);
      const file = virtualFile(source, { properties: config.properties, tolerant: true });
      return file === undefined ? host.getScriptSnapshot(name) : ts.ScriptSnapshot.fromString(file.code);
    };
    return ts.createLanguageService(proxyHost).getSemanticDiagnostics(FILE);
  };

  return { service, plain, withoutThePlugin, caret, source, unmapped };
}

const names = (marked: string) => {
  const { service, caret } = editor(marked);
  return service.getCompletionsAtPosition(FILE, caret, undefined)?.entries.map((entry) => entry.name) ?? [];
};

const SOME_PROPERTIES = ["display", "color", "padding", "position", "gap"];
const POSITION_VALUES = ["static", "relative", "absolute", "sticky", "fixed"];

describe("completion, at every caret a person passes through", () => {
  /**
   * All nine were measured one at a time, and three of them failed on the first design: with nothing
   * typed yet the caret belonged to no mapped run at all and got zero completions — an empty block, a
   * blank line after a declaration, and the position after a semicolon. An empty object literal in
   * the virtual file is what gives that caret somewhere to be.
   */
  test.each([
    ["an empty block", `const a = <div css=@(${CARET} )>x</div>;\n`],
    ["a property being typed", `const a = <div css=@( disp${CARET} )>x</div>;\n`],
    ["a blank line after a declaration", `const a = <div css=@(\n  display: flex;\n  ${CARET}\n)>x</div>;\n`],
    ["after a semicolon on the same line", `const a = <div css=@( display: flex; ${CARET} )>x</div>;\n`],
    ["inside a nested rule", `const a = <div css=@( &:hover { colo${CARET} } )>x</div>;\n`],
    ["a blank line inside a nested rule", `const a = <div css=@(\n  &:hover {\n    ${CARET}\n  }\n)>x</div>;\n`],
    ["a block that has no closing paren yet", `const a = <div css=@( disp${CARET}\nconst after = 1;\n`],
  ])("%s offers the property names", (_what, marked) => {
    const offered = names(marked);

    expect(offered.length).toBeGreaterThan(400);
    for (const property of SOME_PROPERTIES) expect(offered).toContain(property);
  });

  test("a value being typed offers what that property accepts, and nothing else", () => {
    const offered = names(`const a = <div css=@( position: stat${CARET} )>x</div>;\n`);

    for (const value of POSITION_VALUES) expect(offered).toContain(value);
    expect(offered).not.toContain("display");
  });

  test("and a value whose grammar is open offers no union, because there is not one", () => {
    // `display` takes combinations — `inline flow-root` — so it is `string | number` and its typos
    // are the CSS checker's. Said here so the limit is visible from the editor's side too.
    const offered = names(`const a = <div css=@( display: fl${CARET} )>x</div>;\n`);

    expect(offered).not.toContain("flex");
  });

  test("ordinary code in the same file is untouched", () => {
    const offered = names(
      `const before = 1;\nconst a = <div css=@( display: flex; )>x</div>;\nconst c = bef${CARET};\n`,
    );

    expect(offered).toContain("before");
  });

  test("a file with no block at all falls through to the real service", () => {
    const offered = names(`const before = 1;\nconst c = bef${CARET};\n`);

    expect(offered).toContain("before");
  });
});

describe("the red squiggles", () => {
  /**
   * The loud one. The author's file does not parse as TypeScript, so the REAL service reports the
   * block as a syntax error — a squiggle on correct code, which is the worst way for a tool to be
   * wrong. Both diagnostic kinds have to come from the virtual file.
   */
  test("a correct block gets none, even though the file does not parse as TypeScript", () => {
    const marked = `const a = <div css=@( display: flex; gap: 8px; )>x</div>;\nexport default a;\n`;
    const { service, withoutThePlugin } = editor(marked);

    expect(withoutThePlugin().length).toBeGreaterThan(0);
    expect(service.getSyntacticDiagnostics(FILE)).toEqual([]);
    expect(service.getSemanticDiagnostics(FILE)).toEqual([]);
  });

  test("a property typo gets one, at the property", () => {
    const marked = `const a = (\n  <div css=@(\n    dsiplay: flex;\n  )>x</div>\n);\nexport default a;\n`;
    const { service, source } = editor(marked);

    const [only, ...rest] = service.getSemanticDiagnostics(FILE);
    expect(rest).toEqual([]);
    expect(only.start).toBe(source.indexOf("dsiplay"));
    expect(only.length).toBe("dsiplay".length);
    expect(ts.flattenDiagnosticMessageText(only.messageText, " ")).toContain("Did you mean to write 'display'?");
  });

  test("an ordinary type error in the same file still arrives, at its own place", () => {
    const marked = `const n: number = "no";\nconst a = <div css=@( display: flex; )>x</div>;\nexport default [n, a];\n`;
    const { service, source } = editor(marked);

    const [only] = service.getSemanticDiagnostics(FILE);
    expect(only.start).toBe(source.indexOf("n: number"));
  });

  /**
   * A project-wide setup fault — the block shape not resolving — is deliberately NOT surfaced here.
   * An editor would show it on every file the author opens; `ramonda-css` says it once.
   *
   * **The control matters more than the assertion.** Asserting an empty list is what a plugin that
   * silently returned nothing would also pass, so the inner service is asked the same question first
   * and has to have something to say.
   */
  test("the scaffolding's own diagnostics are not shown", () => {
    const marked = `const a = <div css=@( display: flex; )>x</div>;\nexport default a;\n`;
    // A shape that genuinely does not resolve. Leaving `properties` unset does NOT do it — measured:
    // `@ramonda/css/properties` resolves through this package's own `node_modules`, so the default is
    // the real map and there is nothing to report.
    const { service, unmapped } = editor(marked, { properties: "./nothing-is-here" });

    expect(unmapped().length).toBeGreaterThan(0);
    expect(service.getSemanticDiagnostics(FILE)).toEqual([]);
  });
});

describe("the CSS rules, as squiggles", () => {
  /**
   * Where the hole rule earns its place. The build refuses a hole written where a custom property
   * cannot go — there is no correct compilation — so the only place it can be SAID rather than
   * enforced is here, under the character, while it is being typed.
   */
  test("a hole where a custom property cannot go is a warning under the `{{`", () => {
    const marked = `const a = (\n  <div css=@(\n    {{name}}: 24px;\n  )>x</div>\n);\n`;
    const { service, source } = editor(marked);

    const [only] = service.getSemanticDiagnostics(FILE);
    expect(only.start).toBe(source.indexOf("{{"));
    expect(only.length).toBe(2);
    expect(only.category).toBe(ts.DiagnosticCategory.Warning);
    expect(ts.flattenDiagnosticMessageText(only.messageText, " ")).toContain("hole-out-of-place");
  });

  /**
   * One fault, one squiggle. `TS2353` says the same thing the rule does and without the suggestion,
   * because a quoted object key gets none — measured through a real `tsserver`, the editor was
   * showing both while `ramonda-css` had been dropping the duplicate since it was written.
   */
  test("the compiler's word is dropped where a rule of ours said it better", () => {
    const marked = `const a = (\n  <div css=@(\n    flex-dirction: row;\n  )>x</div>\n);\n`;
    const { service } = editor(marked);

    const found = service.getSemanticDiagnostics(FILE);
    expect(found).toHaveLength(1);
    expect(ts.flattenDiagnosticMessageText(found[0].messageText, " ")).toContain("flex-direction");
  });

  test("a property typo the types cannot suggest gets the rule's suggestion", () => {
    const marked = `const a = (\n  <div css=@(\n    flex-dirction: row;\n  )>x</div>\n);\n`;
    const { service, source } = editor(marked);

    const ours = service
      .getSemanticDiagnostics(FILE)
      .filter((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").startsWith("["));

    expect(ours).toHaveLength(1);
    expect(ours[0].start).toBe(source.indexOf("flex-dirction"));
    expect(ts.flattenDiagnosticMessageText(ours[0].messageText, " ")).toContain("flex-direction");
  });

  /**
   * The diagnostic hangs on a source file built from the AUTHOR's text, not the virtual copy. An
   * editor resolves a position against that file, and the two differ inside a block — so the wrong
   * one would put the squiggle wherever they happen to diverge.
   */
  test("the file a diagnostic names holds the author's own text", () => {
    const marked = `const a = (\n  <div css=@(\n    display: flexx;\n  )>x</div>\n);\n`;
    const { service, source } = editor(marked);

    const [only] = service.getSemanticDiagnostics(FILE);
    expect(only.file?.text).toBe(source);
    expect(source.slice(only.start ?? 0, (only.start ?? 0) + (only.length ?? 0))).toBe("flexx");
  });

  test("and a correct block still gets none", () => {
    const { service } = editor(`const a = <div css=@( display: flex; gap: 8px; )>x</div>;\n`);

    expect(service.getSemanticDiagnostics(FILE)).toEqual([]);
  });
});

describe("hover", () => {
  test("over a hole's expression, it is the expression's own type", () => {
    const marked = `const accent: string = "#10b981";\nconst a = <div css=@( color: {{acc${CARET}ent}}; )>x</div>;\n`;
    const { service, caret } = editor(marked);

    const info = service.getQuickInfoAtPosition(FILE, caret);
    expect(info).toBeDefined();
    expect(ts.displayPartsToString(info?.displayParts ?? [])).toContain("string");
  });

  /**
   * A value is a string literal in the virtual file, and TypeScript answers nothing about a position
   * inside one — measured through a real `tsserver`, this came back empty. The question is asked
   * again at the declaration, which is what a reader wanted: the property, its grammar, its initial
   * value, and a link to the page that documents it.
   */
  test("over a value, it is the property that value belongs to", () => {
    const marked = `const a = <div css=@( flex-direction: col${CARET}umn; )>x</div>;\n`;
    const { service, caret } = editor(marked);

    const info = service.getQuickInfoAtPosition(FILE, caret);
    expect(ts.displayPartsToString(info?.displayParts ?? [])).toContain("flex-direction");
    // The documentation the generated map carries — the grammar, out of MDN's own data.
    expect(ts.displayPartsToString(info?.documentation ?? [])).toContain("row-reverse");
  });

  test("over a property name, it is that property with what it accepts", () => {
    const marked = `const a = <div css=@( flex-dir${CARET}ection: column; )>x</div>;\n`;
    const { service, caret } = editor(marked);

    const info = service.getQuickInfoAtPosition(FILE, caret);
    expect(ts.displayPartsToString(info?.displayParts ?? [])).toContain("flex-direction");
    expect(ts.displayPartsToString(info?.documentation ?? [])).toContain("Inherited");
  });

  test("and a file with no block falls through", () => {
    const marked = `const accent: string = "x";\nconst b = acc${CARET}ent;\n`;
    const { service, caret } = editor(marked);

    expect(ts.displayPartsToString(service.getQuickInfoAtPosition(FILE, caret)?.displayParts ?? [])).toContain(
      "string",
    );
  });
});

describe("what the plugin does not touch", () => {
  test("everything else falls through, so nothing an editor offers disappears", () => {
    const marked = `const a = <div css=@( display: flex; )>x</div>;\nexport default a;\n`;
    const { service } = editor(marked);

    // A method the proxy does not override, answering from the real service.
    expect(typeof service.getProgram).toBe("function");
    expect(service.getProgram()).toBeDefined();
  });

  test("a file with no block gets the real service's diagnostics, both kinds", () => {
    const { service } = editor(`const n: number = "no";\nexport default n;\n`);

    expect(service.getSyntacticDiagnostics(FILE)).toEqual([]);
    expect(service.getSemanticDiagnostics(FILE)).toHaveLength(1);
  });

  test("a caret past the end of the file answers nothing rather than guessing", () => {
    const { service, source } = editor(`const a = <div css=@( display: flex; )>x</div>;\n`);

    expect(service.getCompletionsAtPosition(FILE, source.length + 50, undefined)).toBeUndefined();
    expect(service.getQuickInfoAtPosition(FILE, source.length + 50)).toBeUndefined();
  });

  test("and a file that is not source at all behaves exactly as it would with no plugin", () => {
    // `.css`, `.json`, somebody else's virtual module: not ours to read. "Left alone" is the whole
    // claim, so it is asserted as SAMENESS rather than as an outcome — measured, the real service
    // throws for a file outside the program, and the plugin has no business changing that.
    const { service, plain } = editor(`const a = <div css=@( display: flex; )>x</div>;\n`);
    const styles = join(PACKAGE, "src", "__tests__", "styles.css");

    const through = (run: () => unknown) => {
      try {
        return { threw: false, value: run() };
      } catch (error) {
        return { threw: true, message: (error as Error).message };
      }
    };

    expect(through(() => service.getSemanticDiagnostics(styles))).toEqual(
      through(() => plain.getSemanticDiagnostics(styles)),
    );
  });
});

/**
 * The colours the LANGUAGE SERVICE paints, which are not the grammar's.
 *
 * ## The fault this exists for
 *
 * An editor paints twice: a TextMate grammar first, then semantic tokens from the language service
 * over the top. The plugin serves the VIRTUAL file to the service, so every span the service reports
 * is an offset into text the author never wrote — and the preamble alone makes that hundreds of
 * characters. Applied to the author's file at face value, every semantic colour in the file lands on
 * the wrong characters, ABOVE the block as well as below, because the shift is the same everywhere.
 *
 * It cannot be seen in a diagnostic, because a diagnostic is mapped. It is only visible as colour,
 * which is why it survived the whole of track K: the plugin was measured by what it reported.
 */
describe("semantic colours", () => {
  const CODE = `const before = 1;
const a = <div css=@( display: flex; )>x</div>;
const after = 2;
export default [before, a, after];
`;

  const spansOf = (service: ts.LanguageService, source: string) => {
    const { spans } = service.getEncodedSemanticClassifications(
      FILE,
      { start: 0, length: source.length },
      ts.SemanticClassificationFormat.TwentyTwenty,
    );

    const out: { text: string; at: number }[] = [];
    for (let i = 0; i < spans.length; i += 3)
      out.push({ at: spans[i], text: source.slice(spans[i], spans[i] + spans[i + 1]) });
    return out;
  };

  test("a span lands on the identifier it is meant to colour", () => {
    const { service, source } = editor(CODE);

    // `before` is declared ABOVE the block, so nothing about it is the block's business.
    expect(spansOf(service, source)).toContainEqual({ text: "before", at: source.indexOf("before") });
  });

  /** The sweeping version: a semantic token is an identifier, so every span has to slice out one. */
  test("every span slices an identifier out of the author's own text", () => {
    const { service, source } = editor(CODE);
    const notIdentifiers = spansOf(service, source).filter((span) => !/^[A-Za-z_$][\w$]*$/.test(span.text));

    expect(notIdentifiers).toEqual([]);
  });
});

/**
 * Everything else an editor asks about a POSITION.
 *
 * ## The fault this exists for
 *
 * The plugin used to map four methods and let the rest fall through, on the belief that a
 * fall-through answers about the author's own file. It does not: the host is patched in place, so
 * the service reads the virtual text for every question, and an unmapped answer is an offset into
 * text nobody wrote. Measured on a four-line file, all of it was wrong at once — folding spans that
 * sliced nothing, an outline listing `__block` beside the author's own names, go-to-definition
 * landing on the empty string, and a document highlight covering half the file.
 *
 * None of it is visible in a diagnostic, which is why it survived a plugin measured by what it
 * reported.
 */
describe("every other answer that carries a position", () => {
  const CODE = `const before = 1;
const a = <div css=@( display: flex; )>x</div>;
const after = before;
export default [a, after];
`;

  /** What a span really covers in the AUTHOR's file — the only thing an editor can draw. */
  const text = (source: string, span: ts.TextSpan) => source.slice(span.start, span.start + span.length);

  test("folding covers real text", () => {
    const { service, source } = editor(CODE);
    const spans = service.getOutliningSpans(FILE);

    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) expect(text(source, span.textSpan).trim()).not.toBe("");
  });

  test("the outline names what the author wrote, and nothing this package wrote", () => {
    const { service, source } = editor(CODE);
    const items = service.getNavigationTree(FILE).childItems ?? [];

    expect(items.map((item) => item.text)).not.toContain("__block");
    for (const item of items) expect(text(source, item.spans[0]).trim()).not.toBe("");
  });

  test("go-to-definition lands on the declaration", () => {
    const { service, source } = editor(CODE);
    const use = source.indexOf("before", source.indexOf("after"));

    const found = service.getDefinitionAtPosition(FILE, use) ?? [];
    expect(found.map((one) => text(source, one.textSpan))).toEqual(["before"]);
  });

  test("highlighting a name highlights the name, not half the file", () => {
    const { service, source } = editor(CODE);
    const use = source.indexOf("before", source.indexOf("after"));

    const spans = service.getDocumentHighlights(FILE, use, [FILE])?.[0]?.highlightSpans ?? [];
    expect(spans.map((span) => text(source, span.textSpan))).toEqual(["before", "before"]);
  });

  /**
   * The dangerous half, and the one place refusing beats answering: an edit is computed against the
   * virtual text, so applying one to the author's file writes scaffolding into it at an offset that
   * is wrong anyway. `ramonda-css format` is what formats these files.
   */
  test("an edit is refused rather than applied to the wrong text", () => {
    const { service } = editor(CODE);

    expect(service.getFormattingEditsForDocument(FILE, {})).toEqual([]);
    expect(service.getCodeFixesAtPosition(FILE, 0, 5, [2304], {}, {})).toEqual([]);
  });
  /** A caret the block swallowed — inside the scaffolding — answers nothing rather than guessing. */
  test("a position with no home answers nothing", () => {
    const { service, source } = editor(CODE);
    const past = source.length + 50;

    expect(service.getDefinitionAtPosition(FILE, past)).toBeUndefined();
    expect(service.getTypeDefinitionAtPosition(FILE, past)).toBeUndefined();
    expect(service.getImplementationAtPosition(FILE, past)).toBeUndefined();
    expect(service.getReferencesAtPosition(FILE, past)).toBeUndefined();
    expect(service.getDefinitionAndBoundSpan(FILE, past)).toBeUndefined();
    expect(service.getDocumentHighlights(FILE, past, [FILE])).toBeUndefined();
    expect(service.getSignatureHelpItems(FILE, past, undefined)).toBeUndefined();
  });

  test("a reference list, a bound span and the flat outline all land on the author's text", () => {
    const { service, source } = editor(CODE);
    const use = source.indexOf("before", source.indexOf("after"));

    expect((service.getReferencesAtPosition(FILE, use) ?? []).map((one) => text(source, one.textSpan))).toEqual([
      "before",
      "before",
    ]);

    const bound = service.getDefinitionAndBoundSpan(FILE, use);
    expect(text(source, bound?.textSpan ?? { start: 0, length: 0 })).toBe("before");
    expect((bound?.definitions ?? []).map((one) => text(source, one.textSpan))).toEqual(["before"]);

    for (const item of service.getNavigationBarItems(FILE)) {
      expect(item.text).not.toBe("__block");
      expect(text(source, item.spans[0]).trim()).not.toBe("");
    }
  });

  test("a type and an implementation are found where they are written", () => {
    const marked = `interface Shape { n: number }\nconst s: Shape = { n: 1 };\nconst a = <div css=@( display: flex; )>x</div>;\nexport default [s, a];\n`;
    const { service, source } = editor(marked);
    const use = source.indexOf("s", source.indexOf("export default"));

    expect((service.getTypeDefinitionAtPosition(FILE, use) ?? []).map((one) => text(source, one.textSpan))).toEqual([
      "Shape",
    ]);
    expect(service.getImplementationAtPosition(FILE, use)).toBeDefined();
  });

  test("signature help points at the call being written", () => {
    const marked = `function f(n: number) { return n; }\nconst a = <div css=@( display: flex; )>x</div>;\nconst b = f(1);\nexport default [a, b];\n`;
    const { service, source } = editor(marked);
    const inside = source.indexOf("f(1)") + 2;

    const help = service.getSignatureHelpItems(FILE, inside, undefined);
    expect(text(source, help?.applicableSpan ?? { start: 0, length: 0 })).toBe("1");
  });

  /**
   * A file with no block is not ours, and every one of these has to behave as if the plugin were not
   * installed — asserted as sameness, because "it answered something" is what a broken proxy does too.
   */
  test("a file with no block is answered by the real service, for every one of them", () => {
    const plainCode = `function f(n: number) { return n; }\nconst before = 1;\nconst after = before;\nexport default [f(1), after];\n`;
    const { service, plain, source } = editor(plainCode);
    const use = source.indexOf("before", source.indexOf("after"));

    expect(service.getOutliningSpans(FILE)).toEqual(plain.getOutliningSpans(FILE));
    expect(service.getNavigationTree(FILE)).toEqual(plain.getNavigationTree(FILE));
    expect(service.getNavigationBarItems(FILE)).toEqual(plain.getNavigationBarItems(FILE));
    expect(service.getDefinitionAtPosition(FILE, use)).toEqual(plain.getDefinitionAtPosition(FILE, use));
    expect(service.getTypeDefinitionAtPosition(FILE, use)).toEqual(plain.getTypeDefinitionAtPosition(FILE, use));
    expect(service.getImplementationAtPosition(FILE, use)).toEqual(plain.getImplementationAtPosition(FILE, use));
    expect(service.getReferencesAtPosition(FILE, use)).toEqual(plain.getReferencesAtPosition(FILE, use));
    expect(service.getDefinitionAndBoundSpan(FILE, use)).toEqual(plain.getDefinitionAndBoundSpan(FILE, use));
    expect(service.getDocumentHighlights(FILE, use, [FILE])).toEqual(plain.getDocumentHighlights(FILE, use, [FILE]));
    expect(service.getSignatureHelpItems(FILE, source.indexOf("f(1)") + 2, undefined)).toEqual(
      plain.getSignatureHelpItems(FILE, source.indexOf("f(1)") + 2, undefined),
    );
    expect(service.getFormattingEditsForDocument(FILE, {})).toEqual(plain.getFormattingEditsForDocument(FILE, {}));
    expect(service.getFormattingEditsForRange(FILE, 0, 5, {})).toEqual(
      plain.getFormattingEditsForRange(FILE, 0, 5, {}),
    );
    expect(service.getFormattingEditsAfterKeystroke(FILE, 5, ";", {})).toEqual(
      plain.getFormattingEditsAfterKeystroke(FILE, 5, ";", {}),
    );
    expect(service.getCodeFixesAtPosition(FILE, 0, 5, [2304], {}, {})).toEqual(
      plain.getCodeFixesAtPosition(FILE, 0, 5, [2304], {}, {}),
    );
    expect(service.getApplicableRefactors(FILE, 5, {})).toEqual(plain.getApplicableRefactors(FILE, 5, {}));
    expect(service.getEncodedSemanticClassifications(FILE, { start: 0, length: source.length })).toEqual(
      plain.getEncodedSemanticClassifications(FILE, { start: 0, length: source.length }),
    );
  });

  test("and the rest of the edits are refused for a file that holds one", () => {
    const { service } = editor(CODE);

    expect(service.getFormattingEditsForRange(FILE, 0, 5, {})).toEqual([]);
    expect(service.getFormattingEditsAfterKeystroke(FILE, 5, ";", {})).toEqual([]);
    expect(service.getApplicableRefactors(FILE, 5, {})).toEqual([]);
  });
});
