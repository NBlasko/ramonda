import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
function editor(
  marked: string,
  config: { properties?: string; as?: string } = { properties: join(PACKAGE, "src", "properties") },
) {
  const source = marked.replace(CARET, "");
  const caret = marked.indexOf(CARET);
  /**
   * The file is in the program under its NORMALISED path — which is the only way a program works —
   * and also answers to the spelling the editor uses, exactly as a filesystem does: both paths open
   * one file. `config.as` is that second spelling, and the questions are asked under it.
   */
  const files: Record<string, string> = { [FILE]: source, [JSX_FILE]: JSX_TYPES };
  if (config.as !== undefined) files[config.as] = source;

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
  /**
   * What `tsserver`'s own `Project` provides, and a bare host does not.
   *
   * `toLineColumnOffset` asks the host for a source file and falls back to `readFile` when there is
   * none — so a plain harness reads the AUTHOR's text and cannot see the fault this exists for. The
   * real editor hands over the PROGRAM's file, which holds the virtual text. Without this line the
   * assertions below pass whether or not the proxy does anything.
   */
  (host as { getSourceFileLike?: (name: string) => ts.SourceFile | undefined }).getSourceFileLike = (name) =>
    plain.getProgram()?.getSourceFile(name);
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
    ["an empty block", `const a = <div css=@@(${CARET} )>x</div>;\n`],
    ["a property being typed", `const a = <div css=@@( disp${CARET} )>x</div>;\n`],
    ["a blank line after a declaration", `const a = <div css=@@(\n  display: flex;\n  ${CARET}\n)>x</div>;\n`],
    ["after a semicolon on the same line", `const a = <div css=@@( display: flex; ${CARET} )>x</div>;\n`],
    ["inside a nested rule", `const a = <div css=@@( &:hover { colo${CARET} } )>x</div>;\n`],
    ["a blank line inside a nested rule", `const a = <div css=@@(\n  &:hover {\n    ${CARET}\n  }\n)>x</div>;\n`],
    ["a block that has no closing paren yet", `const a = <div css=@@( disp${CARET}\nconst after = 1;\n`],
  ])("%s offers the property names", (_what, marked) => {
    const offered = names(marked);

    expect(offered.length).toBeGreaterThan(400);
    for (const property of SOME_PROPERTIES) expect(offered).toContain(property);
  });

  test("a value being typed offers what that property accepts, and nothing else", () => {
    const offered = names(`const a = <div css=@@( position: stat${CARET} )>x</div>;\n`);

    for (const value of POSITION_VALUES) expect(offered).toContain(value);
    expect(offered).not.toContain("display");
  });

  /**
   * An open grammar has no union, so TypeScript offers nothing — and this package offers the words
   * itself. See *completion in a value* below for what that is and why it is a second table.
   */
  test("and a value whose grammar is open is answered by us, not by a union", () => {
    const offered = names(`const a = <div css=@@( display: fl${CARET} )>x</div>;\n`);

    expect(offered).toContain("flex");
    // TypeScript's own union list carries these; ours does not, which is how the two are told apart.
    expect(offered).not.toContain("flex !important");
  });

  test("ordinary code in the same file is untouched", () => {
    const offered = names(
      `const before = 1;\nconst a = <div css=@@( display: flex; )>x</div>;\nconst c = bef${CARET};\n`,
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
    const marked = `const a = <div css=@@( display: flex; gap: 8px; )>x</div>;\nexport default a;\n`;
    const { service, withoutThePlugin } = editor(marked);

    expect(withoutThePlugin().length).toBeGreaterThan(0);
    expect(service.getSyntacticDiagnostics(FILE)).toEqual([]);
    expect(service.getSemanticDiagnostics(FILE)).toEqual([]);
  });

  test("a property typo gets one, at the property", () => {
    const marked = `const a = (\n  <div css=@@(\n    dsiplay: flex;\n  )>x</div>\n);\nexport default a;\n`;
    const { service, source } = editor(marked);

    const [only, ...rest] = service.getSemanticDiagnostics(FILE);
    expect(rest).toEqual([]);
    expect(only.start).toBe(source.indexOf("dsiplay"));
    expect(only.length).toBe("dsiplay".length);
    expect(ts.flattenDiagnosticMessageText(only.messageText, " ")).toContain("Did you mean to write 'display'?");
  });

  test("an ordinary type error in the same file still arrives, at its own place", () => {
    const marked = `const n: number = "no";\nconst a = <div css=@@( display: flex; )>x</div>;\nexport default [n, a];\n`;
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
    const marked = `const a = <div css=@@( display: flex; )>x</div>;\nexport default a;\n`;
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
  test("a hole where a custom property cannot go is an error under the `{`", () => {
    const marked = `const a = (\n  <div css=@@(\n    {name}: 24px;\n  )>x</div>\n);\n`;
    const { service, source } = editor(marked);

    const [only] = service.getSemanticDiagnostics(FILE);
    expect(only.start).toBe(source.indexOf("{", source.indexOf("@@(") + 3));
    expect(only.length).toBe(1);
    expect(only.category).toBe(ts.DiagnosticCategory.Error);
    expect(ts.flattenDiagnosticMessageText(only.messageText, " ")).toContain("hole-out-of-place");
  });

  /**
   * **An error, and it was a warning until the build began refusing these.**
   *
   * The old note said a warning was the honest answer because a page with `display: flexx` renders
   * and the declaration is simply dropped. That stopped being true the day `transform` started
   * running the checker: every finding these rules produce now REFUSES the build, so a yellow
   * squiggle sat under something that does not compile — the editor promising a page the build will
   * not give.
   *
   * The severity is not a judgement about how bad the CSS is. It is the answer to "will this
   * build?", and there is one answer.
   */
  test.each([
    ["an unknown value", `const a = <div css=@@( position: statikk; )>x</div>;\n`],
    ["a `//` comment", `const a = <div css=@@(\n  // why\n  color: red;\n)>x</div>;\n`],
    ["a dashed property near a real one", `const a = <div css=@@( padding-lft: 8px; )>x</div>;\n`],
  ])("%s is an error, because the build refuses it", (_what, marked) => {
    const { service } = editor(marked);
    const [only] = service.getSemanticDiagnostics(FILE);

    expect(only.category).toBe(ts.DiagnosticCategory.Error);
  });

  /**
   * And the one that is NOT the build's business keeps its own severity: nothing is wrong with a
   * block an editor cannot colour, so it stays a suggestion. If this ever became an error the
   * editor would be failing a file over a grammar nobody can see.
   */
  test("but an uncolourable block stays a suggestion", () => {
    const marked = `const a = <div id="x" css=@@( color: red; )>x</div>;\n`;
    const { service } = editor(marked);

    const hints = service
      .getSemanticDiagnostics(FILE)
      .filter((one) => ts.flattenDiagnosticMessageText(one.messageText, " ").includes("uncolourable-block"));

    expect(hints).toHaveLength(1);
    expect(hints[0].category).toBe(ts.DiagnosticCategory.Suggestion);
  });

  /**
   * One fault, one squiggle. `TS2353` says the same thing the rule does and without the suggestion,
   * because a quoted object key gets none — measured through a real `tsserver`, the editor was
   * showing both while `ramonda-css` had been dropping the duplicate since it was written.
   */
  test("the compiler's word is dropped where a rule of ours said it better", () => {
    const marked = `const a = (\n  <div css=@@(\n    flex-dirction: row;\n  )>x</div>\n);\n`;
    const { service } = editor(marked);

    const found = service.getSemanticDiagnostics(FILE);
    expect(found).toHaveLength(1);
    expect(ts.flattenDiagnosticMessageText(found[0].messageText, " ")).toContain("flex-direction");
  });

  test("a property typo the types cannot suggest gets the rule's suggestion", () => {
    const marked = `const a = (\n  <div css=@@(\n    flex-dirction: row;\n  )>x</div>\n);\n`;
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
    const marked = `const a = (\n  <div css=@@(\n    display: flexx;\n  )>x</div>\n);\n`;
    const { service, source } = editor(marked);

    const [only] = service.getSemanticDiagnostics(FILE);
    expect(only.file?.text).toBe(source);
    expect(source.slice(only.start ?? 0, (only.start ?? 0) + (only.length ?? 0))).toBe("flexx");
  });

  test("and a correct block still gets none", () => {
    const { service } = editor(`const a = <div css=@@( display: flex; gap: 8px; )>x</div>;\n`);

    expect(service.getSemanticDiagnostics(FILE)).toEqual([]);
  });
});

describe("hover", () => {
  test("over a hole's expression, it is the expression's own type", () => {
    const marked = `const accent: string = "#10b981";\nconst a = <div css=@@( color: {acc${CARET}ent}; )>x</div>;\n`;
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
    const marked = `const a = <div css=@@( flex-direction: col${CARET}umn; )>x</div>;\n`;
    const { service, caret } = editor(marked);

    const info = service.getQuickInfoAtPosition(FILE, caret);
    // The grammar — out of MDN's own data — is the SIGNATURE line now rather than a footnote.
    // See *hovering a declaration*: it moved up, it was not copied.
    expect(ts.displayPartsToString(info?.displayParts ?? [])).toContain("flex-direction");
    expect(ts.displayPartsToString(info?.displayParts ?? [])).toContain("row-reverse");
  });

  test("over a property name, it is that property with what it accepts", () => {
    const marked = `const a = <div css=@@( flex-dir${CARET}ection: column; )>x</div>;\n`;
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
    const marked = `const a = <div css=@@( display: flex; )>x</div>;\nexport default a;\n`;
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
    const { service, source } = editor(`const a = <div css=@@( display: flex; )>x</div>;\n`);

    expect(service.getCompletionsAtPosition(FILE, source.length + 50, undefined)).toBeUndefined();
    expect(service.getQuickInfoAtPosition(FILE, source.length + 50)).toBeUndefined();
  });

  test("and a file that is not source at all behaves exactly as it would with no plugin", () => {
    // `.css`, `.json`, somebody else's virtual module: not ours to read. "Left alone" is the whole
    // claim, so it is asserted as SAMENESS rather than as an outcome — measured, the real service
    // throws for a file outside the program, and the plugin has no business changing that.
    const { service, plain } = editor(`const a = <div css=@@( display: flex; )>x</div>;\n`);
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
const a = <div css=@@( display: flex; )>x</div>;
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

  /**
   * Inside a block the GRAMMAR is the authority, and TypeScript's opinion is not just redundant, it
   * is wrong. Measured in a real editor: `display` came out white and `flex-direction` blue, in the
   * same block, and the two have identical TextMate scopes. The difference was the semantic layer —
   * `display` is a bare key in the virtual file and gets a token, `flex-direction` has to be quoted
   * and gets none — so a CSS property was painted as a TypeScript property, at random.
   *
   * A hole is the exception, and it has to be: it really is TypeScript, and `this.weight` inside one
   * should read as `this.weight` reads anywhere else.
   */
  test("no semantic token paints the CSS, and a hole still gets one", () => {
    const marked = `const accent = "red";\nconst a = <div css=@@( display: flex; color: {accent}; )>x</div>;\nexport default [a, accent];\n`;
    const { service, source } = editor(marked);
    const covers = (what: string) => {
      const at = source.indexOf(what, source.indexOf("css=@@("));
      return spansOf(service, source).some((span) => span.at <= at && at < span.at + span.text.length);
    };

    expect(covers("display")).toBe(false);
    expect(covers("flex")).toBe(false);
    expect(covers("accent")).toBe(true);
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
const a = <div css=@@( display: flex; )>x</div>;
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

  /**
   * A position the mapping reaches but TypeScript has nothing to say about — a blank line. Each of
   * these has to hand back the service's own silence rather than invent an answer out of a span it
   * never got.
   */
  test("a position with nothing to say answers nothing", () => {
    const { service, source } = editor(CODE);
    const blank = source.indexOf("\n") + 1;

    expect(service.getDefinitionAndBoundSpan(FILE, blank)).toBeUndefined();
    expect(service.getDocumentHighlights(FILE, blank, [FILE])).toBeUndefined();
    expect(service.getSignatureHelpItems(FILE, blank, undefined)).toBeUndefined();
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
    const marked = `interface Shape { n: number }\nconst s: Shape = { n: 1 };\nconst a = <div css=@@( display: flex; )>x</div>;\nexport default [s, a];\n`;
    const { service, source } = editor(marked);
    const use = source.indexOf("s", source.indexOf("export default"));

    expect((service.getTypeDefinitionAtPosition(FILE, use) ?? []).map((one) => text(source, one.textSpan))).toEqual([
      "Shape",
    ]);
    expect(service.getImplementationAtPosition(FILE, use)).toBeDefined();
  });

  test("signature help points at the call being written", () => {
    const marked = `function f(n: number) { return n; }\nconst a = <div css=@@( display: flex; )>x</div>;\nconst b = f(1);\nexport default [a, b];\n`;
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

/**
 * The one thing an editor knows that a build has no business failing over.
 *
 * ## The fault this exists for
 *
 * An editor stops consulting syntax injections the moment it enters a tag's attribute list, so a
 * bare `css=@@( … )` is only coloured when it is the FIRST attribute on the tag name's own line.
 * Written anywhere else it still compiles, is still checked, and looks like an error — and there is
 * nothing on the screen to say why, because the thing that failed is a grammar nobody can see.
 *
 * It is a SUGGESTION, not a warning and certainly not a build failure. Nothing is wrong with the
 * code: `ramonda-css` exits non-zero on any finding it reports, and stopping a build because an
 * editor will not colour something would be the wrong weight by a mile.
 */
describe("a block an editor cannot colour", () => {
  const suggestions = (marked: string) =>
    editor(marked)
      .service.getSemanticDiagnostics(FILE)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Suggestion);

  test.each([
    ["not the first attribute", `const a = <div className="lead" css=@@( display: flex; )>y</div>;\n`],
    ["on the line below the tag name", `const a = (\n  <div\n    css=@@( display: flex; )\n  >y</div>\n);\n`],
  ])("%s is pointed at the braced spelling", (_what, source) => {
    const [only, ...rest] = suggestions(source);

    expect(rest).toEqual([]);
    expect(ts.flattenDiagnosticMessageText(only.messageText, " ")).toContain("css={@@(");
    // On the name, which is the part to change.
    expect(source.slice(only.start ?? 0, (only.start ?? 0) + (only.length ?? 0))).toBe("css");
  });

  test.each([
    ["the first attribute, on the tag name's line", `const a = <div css=@@( display: flex; )>y</div>;\n`],
    ["a braced attribute", `const a = <div className="lead" css={@@( display: flex; )}>y</div>;\n`],
    ["a value outside JSX", `const panel = @@( display: flex; );\nexport default panel;\n`],
  ])("%s says nothing", (_what, source) => {
    expect(suggestions(source)).toEqual([]);
  });

  /** A suggestion is not a failure, and the rest of the file's diagnostics are unaffected by it. */
  test("it does not become an error anywhere", () => {
    const source = `const a = <div className="lead" css=@@( display: flex; )>y</div>;\n`;
    const errors = editor(source)
      .service.getSemanticDiagnostics(FILE)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

    expect(errors).toEqual([]);
  });
});

/**
 * Completion inside a NAMED block, where the vocabulary is not the properties.
 *
 * The virtual file types each named body against its own surface, and completion comes from the same
 * types — so this asks whether that reaches the editor, not whether the type is right. What would be
 * wrong is subtle and unhelpful rather than broken: 551 property names offered where thirteen
 * descriptors belong, and `src` — the one descriptor a `@font-face` cannot do without — missing from
 * the list.
 */
describe("completion inside a named block", () => {
  test("a font face offers its descriptors", () => {
    const offered = names(`const brand = @@font-face(\n  fo${CARET}\n);\n`);

    expect(offered).toContain("src");
    expect(offered).toContain("font-family");
    expect(offered).toContain("font-display");
  });

  test("and not the properties, which are a different vocabulary", () => {
    const offered = names(`const brand = @@font-face(\n  fo${CARET}\n);\n`);

    expect(offered).not.toContain("display");
    expect(offered).not.toContain("padding");
  });

  /**
   * What an editor would actually WRITE, which is the name when there is no `insertText` beside it.
   *
   * A name that cannot be an identifier is a quoted key in the virtual file, and against a plain
   * interface TypeScript offers it with the quotes still on. Measured: accepting `"font-family"` put
   * those quotes into the author's CSS, where they are a parse error — and an ordinary block never
   * showed it, because its shape carries index signatures and TypeScript answers those bare.
   */
  test("and what it offers is spelled as CSS spells it, with no quotes to accept", () => {
    const { service, caret } = editor(`const brand = @@font-face(\n  fo${CARET}\n);\n`);
    const entries = service.getCompletionsAtPosition(FILE, caret, undefined)?.entries ?? [];
    const family = entries.find((entry) => entry.name.includes("font-family"));

    expect(family?.name).toBe("font-family");
    expect(family?.insertText ?? family?.name).toBe("font-family");
  });

  test("a registered property offers the three it takes", () => {
    const offered = names(`const angle = @@property(\n  ${CARET}\n);\n`);

    expect(offered).toEqual(expect.arrayContaining(["syntax", "inherits", "initial-value"]));
  });

  test("and a frame's contents are ordinary properties again", () => {
    const offered = names(`const slide = @@keyframes(\n  from { op${CARET} }\n);\n`);

    expect(offered).toContain("opacity");
  });
});

/**
 * Completion in a VALUE, for the properties TypeScript cannot help with.
 *
 * 123 properties have a closed grammar and get a real union, so TypeScript offers their values and
 * offers them better — with `!important` and `var()` beside them. **The other 428 are
 * `string | number`, and measured, we offered NOTHING there**: typing `transform: n` gave zero
 * entries, so the editor fell back to its own word list and suggested `nav`, `noframes`, `noscript`
 * — HTML tag names, in a CSS value.
 *
 * The list to offer already exists and is the one the CHECKER reads: `KEYWORDS` holds the bare words
 * each property's grammar reaches, for exactly the properties whose values the types do not cover.
 * So the same table that reports `display: flexx` is what suggests `flex` — one answer, asked twice,
 * which is the arrangement this package keeps having to repair when it is two.
 */
describe("completion in a value", () => {
  test("an open grammar offers the words its own property accepts", () => {
    const offered = names(`const a = <div css=@@( transform: n${CARET} )>x</div>;\n`);

    expect(offered).toContain("none");
  });

  test("and a longer list is offered whole, not filtered by us", () => {
    const offered = names(`const a = <div css=@@( overflow: ${CARET} )>x</div>;\n`);

    expect(offered).toEqual(expect.arrayContaining(["auto", "clip", "hidden", "scroll", "visible"]));
  });

  test("the CSS-wide keywords are there too, because every property takes them", () => {
    const offered = names(`const a = <div css=@@( transform: ${CARET} )>x</div>;\n`);

    expect(offered).toEqual(expect.arrayContaining(["inherit", "initial", "unset", "revert", "revert-layer"]));
  });

  test("a property whose value is a property NAME offers those", () => {
    const offered = names(`const a = <div css=@@( transition: b${CARET} )>x</div>;\n`);

    expect(offered).toContain("background");
  });

  /** A closed grammar is the types' to answer, and theirs is better — `var()` and `!important` too. */
  test("a closed grammar is left to TypeScript", () => {
    const offered = names(`const a = <div css=@@( position: st${CARET} )>x</div>;\n`);

    expect(offered).toContain("static");
    expect(offered).toContain("static !important");
  });

  /**
   * A grammar that admits a free identifier still reaches keywords, and those are worth offering —
   * which is the difference between SUGGESTING and reporting. `KEYWORDS` holds only closed grammars
   * because an unknown word there cannot be called wrong; `VALUE_WORDS` holds every property that
   * reaches a word at all, because `cursor: pointer` is the answer either way.
   *
   * What nothing can suggest is the author's own name — and nothing does: `sl` for a keyframes name
   * gets `none` and the CSS-wide keywords, not a guess.
   */
  test("a grammar with a free identifier still offers the words it does have", () => {
    expect(names(`const a = <div css=@@( animation-name: n${CARET} )>x</div>;\n`)).toContain("none");
    expect(names(`const a = <div css=@@( font-family: s${CARET} )>x</div>;\n`)).toEqual(
      expect.arrayContaining(["serif", "sans-serif", "monospace"]),
    );
    expect(names(`const a = <div css=@@( cursor: p${CARET} )>x</div>;\n`)).toContain("pointer");
  });

  test("a hole is TypeScript, and keeps being TypeScript", () => {
    const offered = names(`const accent = "red";\nconst a = <div css=@@( color: {acc${CARET}}; )>x</div>;\n`);

    expect(offered).toContain("accent");
    expect(offered).not.toContain("inherit");
  });

  test("a property NAME still offers property names", () => {
    const offered = names(`const a = <div css=@@( disp${CARET} )>x</div>;\n`);

    expect(offered).toContain("display");
  });

  test("a value inside a nested rule is a value too", () => {
    const offered = names(`const a = <div css=@@( &:hover { transform: n${CARET} } )>x</div>;\n`);

    expect(offered).toContain("none");
  });
});

/**
 * The shapes a person actually typed, from a real editor.
 *
 * Reported with a screenshot: `align-items: c` offered `canvas`, `cap`, `caption`, `cc:ie`, `code`,
 * `col` — Emmet's HTML abbreviations, which is what fills the gap when a language service offers
 * nothing at all. These are the same carets, asserted.
 */
describe("what a person typed", () => {
  test.each([
    ["align-items: c", "center"],
    ["cursor: p", "pointer"],
    ["transform: n", "none"],
    ["display: fl", "flex"],
    ["overflow: h", "hidden"],
    ["text-transform: u", "uppercase"],
    ["justify-content: sp", "space-between"],
    ["border-left: so", "solid"],
    ["font-weight: b", "bold"],
    ["white-space: now", "nowrap"],
  ])("`%s` offers `%s`", (typed, wanted) => {
    expect(names(`const a = <div css=@@( ${typed}${CARET} )>x</div>;\n`)).toContain(wanted);
  });

  test("and no HTML abbreviation reaches a CSS value", () => {
    const offered = names(`const a = <div css=@@( align-items: c${CARET} )>x</div>;\n`);

    for (const junk of ["canvas", "caption", "cite", "code", "col", "cc:ie"]) {
      expect(offered, `${junk} is markup, not a CSS value`).not.toContain(junk);
    }
  });
});

/**
 * A value can be a FUNCTION, and for some properties that is the only useful answer.
 *
 * The checker's word scan drops function names on purpose — a call is not a bare word, so it can
 * never be reported as a wrong one. Completion is the other question again: `transform` reaches
 * exactly one keyword, `none`, while `translate`, `rotate` and `scale` are what an author is
 * reaching for. Measured, they were all missing.
 */
describe("a value that is a function", () => {
  test.each([
    ["transform: tr", "translate()"],
    ["transform: rot", "rotate()"],
    ["filter: bl", "blur()"],
    ["background-image: lin", "linear-gradient()"],
    ["grid-template-columns: rep", "repeat()"],
    ["color: rg", "rgb()"],
    ["width: cl", "clamp()"],
  ])("`%s` offers `%s`", (typed, wanted) => {
    expect(names(`const a = <div css=@@( ${typed}${CARET} )>x</div>;\n`)).toContain(wanted);
  });

  test("it is inserted without the closing bracket, so the caret lands in the arguments", () => {
    const { service, caret } = editor(`const a = <div css=@@( transform: tr${CARET} )>x</div>;\n`);
    const entry = service
      .getCompletionsAtPosition(FILE, caret, undefined)
      ?.entries.find((one) => one.name === "translate()");

    expect(entry?.insertText).toBe("translate(");
  });

  test("and a keyword sorts above a function, because it is the shorter answer", () => {
    const { service, caret } = editor(`const a = <div css=@@( transform: ${CARET} )>x</div>;\n`);
    const entries = service.getCompletionsAtPosition(FILE, caret, undefined)?.entries ?? [];

    expect(entries.find((one) => one.name === "none")?.sortText).toBe("0");
    expect(entries.find((one) => one.name === "rotate()")?.sortText).toBe("1");
  });

  test("`var()` is offered everywhere, because every property takes it", () => {
    expect(names(`const a = <div css=@@( transform: v${CARET} )>x</div>;\n`)).toContain("var()");
    expect(names(`const a = <div css=@@( cursor: v${CARET} )>x</div>;\n`)).toContain("var()");
  });
});

/**
 * Hovering a declaration reads as CSS, not as the object literal it is checked through.
 *
 * The type map is an object type, so TypeScript's own answer is
 * `(property) "padding-left"?: CssValue | undefined` — true, and the least useful true thing to put
 * on the first and largest line. What a person hovering a CSS property wants is its GRAMMAR.
 *
 * The grammar is already there: the generated type carries it as JSDoc, whose first line is
 * `` `name` — `syntax` ``, written by `build-css-properties.mjs`. So this moves it up rather than
 * finding it again — one source, and a test that pins the shape so it cannot drift in silence.
 */
describe("hovering a declaration", () => {
  const hover = (source: string) => {
    const { service, caret } = editor(source);
    const got = service.getQuickInfoAtPosition(FILE, caret);
    return {
      signature: got?.displayParts?.map((one) => one.text).join("") ?? "",
      documentation: got?.documentation?.map((one) => one.text).join("") ?? "",
    };
  };

  test("the first line is the property and its grammar", () => {
    const { signature } = hover(`const a = <div css=@@( padd${CARET}ing-left: 12px; )>x</div>;\n`);

    expect(signature).toBe("padding-left: <length-percentage [0,∞]>");
  });

  test("and what is left below is what the first line does not say", () => {
    const { documentation } = hover(`const a = <div css=@@( padd${CARET}ing-left: 12px; )>x</div>;\n`);

    expect(documentation).toContain("Initial: `0`. Inherited: no.");
    // Not twice — the grammar moved up, it was not copied.
    expect(documentation).not.toContain("<length-percentage");
  });

  test("hovering the VALUE says the same thing, because it is the same declaration", () => {
    const { signature } = hover(`const a = <div css=@@( padding-left: 12${CARET}px; )>x</div>;\n`);

    expect(signature).toBe("padding-left: <length-percentage [0,∞]>");
  });

  test("a shorthand says what it sets", () => {
    const { signature } = hover(`const a = <div css=@@( pad${CARET}ding: 12px; )>x</div>;\n`);

    expect(signature).toContain("padding:");
  });

  /** A custom property has no grammar to state, so TypeScript's own answer stands. */
  test("a custom property is left to TypeScript", () => {
    const { signature } = hover(`const a = <div css=@@( --Acc${CARET}ent: red; )>x</div>;\n`);

    expect(signature).not.toBe("");
    expect(signature).toContain("--Accent");
  });

  test("and a hover outside the CSS is untouched", () => {
    const { signature } = hover(`const acc${CARET}ent = "red";\nconst a = <div css=@@( color: red; )>x</div>;\n`);

    expect(signature).toContain("accent");
  });
});

/**
 * Going to a binding a block READS, from inside the block.
 *
 * **Reported by a user**: ctrl+click on `CONTROL` or `TONES` inside a `...{ … }` landed on the JSDoc
 * above the declaration rather than on the declaration, and they could see no pattern in it. The
 * pattern is length: a span that starts a few characters early is invisible until the thing above it
 * is long, and both of those carry a paragraph of comment.
 *
 * Three things could produce it and they are fixed differently, so this measures rather than guesses:
 * whether the span TypeScript returns already covers the comment, whether the plugin maps it, and
 * whether the mapping is off by a boundary. The assertion is on the character the span lands on,
 * which says which of the three it is in one run.
 */
/**
 * The same file, asked for under a path spelled a different way — which is what broke it.
 *
 * **Reported by the user twice**, and the first investigation could not reproduce it because it
 * always asked under the identical string. The mapping back to the author's file is skipped for a
 * definition in ANOTHER file, and "another" was decided by `!==` on two paths. TypeScript normalises
 * the path it puts in a definition entry; an editor does not always ask under the normalised one —
 * a symlinked checkout, a differently-cased drive, a `./` left in a project reference — and then the
 * two strings differ, the entry comes back untouched, and a VIRTUAL offset is used as an author
 * offset.
 *
 * The symptom is what makes it hard to place: the position is wrong by exactly the length of the
 * virtual file's preamble, so it lands mid-word in whatever happens to sit there — for the user, in
 * the middle of the paragraph of JSDoc above the declaration. It does it from the block AND from the
 * declaration itself, which is the clue that says it is not about blocks at all.
 */
/**
 * Turning an offset into a line and a column — the one method nothing proxied, and the whole reason
 * go-to-definition landed in the wrong place.
 *
 * **Reported by the user three times.** Two investigations looked at whether the SPAN was mapped, and
 * it was: measured against their own file through a real `tsserver`, the plugin answered
 * `virtual 10081 → author 9799`, which is exactly right. The span was never the problem.
 *
 * `tsserver` then converts that offset to a line and a column, and `toFileSpan` does it with
 * **`languageService.toLineColumnOffset`** rather than with the editor's own line map. That method
 * reads the program's source file — the VIRTUAL text — so a correct author offset came back as a
 * position in a file nobody wrote. Measured, and it matches the report to the character:
 *
 *     offset 9799   in the author's text  -> 307:7     the declaration
 *                   in the virtual text   -> 302:55    inside the comment above it
 *
 * `navtree` was the control that made it findable: it reports the same declaration at 307:7, because
 * it converts through the editor's `ScriptInfo` instead. One question, two answers, and only one of
 * them went through this method.
 */
describe("an offset turned into a line and a column", () => {
  const SOURCE =
    `/**\n * A comment long enough that landing inside it is unmistakable, and then some more of it.\n */\n` +
    `const CONTROL = @@( color: red; );\n\nconst card = @@(\n  ...{CONTROL};\n  padding: 8px;\n);\n`;

  /** Where a position really is, counted in the author's own text. */
  const trueLine = (source: string, at: number) => {
    const before = source.slice(0, at);
    return { line: before.split("\n").length - 1, character: at - (before.lastIndexOf("\n") + 1) };
  };

  test("is counted in the author's text, not in the virtual one", () => {
    const { service, source } = editor(SOURCE);
    const at = source.indexOf("const CONTROL") + "const ".length;

    expect(service.toLineColumnOffset?.(FILE, at)).toEqual(trueLine(source, at));
  });

  test("and above a block too, where the two texts still agree", () => {
    const { service, source } = editor(SOURCE);
    const at = source.indexOf("A comment long");

    expect(service.toLineColumnOffset?.(FILE, at)).toEqual(trueLine(source, at));
  });

  test("a file with no block at all is left to the service", () => {
    const plain = `export const a = 1;\n`;
    const { service } = editor(plain);

    expect(service.toLineColumnOffset?.(FILE, plain.indexOf("a = 1"))).toEqual(trueLine(plain, plain.indexOf("a = 1")));
  });
});

describe("a file asked for under a differently spelled path", () => {
  const SOURCE =
    `/**\n * A comment long enough that landing inside it is unmistakable, and then some more of it.\n */\n` +
    `const CONTROL = @@( color: red; );\n\nconst card = @@(\n  ...{CONTROL};\n  padding: 8px;\n);\n`;

  // Built by concatenation, not by `join` — which normalises, and normalising is the whole point.
  const DIRECTORY = join(PACKAGE, "src", "__tests__");

  test.each([
    ["a `.` segment in the middle", `${DIRECTORY}/./Card.tsx`],
    ["a doubled separator", `${DIRECTORY}//Card.tsx`],
  ])("%s still maps the definition home", (_what, spelled) => {
    const { service, source } = editor(SOURCE, { properties: join(PACKAGE, "src", "properties"), as: spelled });
    const at = source.lastIndexOf("...{CONTROL}") + 4;

    const [only] = service.getDefinitionAtPosition(spelled, at) ?? [];
    if (only === undefined) throw new Error("no definition");

    expect(source.slice(only.textSpan.start, only.textSpan.start + only.textSpan.length)).toBe("CONTROL");
  });

  test("and so does a document highlight", () => {
    const spelled = `${join(PACKAGE, "src", "__tests__")}/./Card.tsx`;
    const { service, source } = editor(SOURCE, { properties: join(PACKAGE, "src", "properties"), as: spelled });
    const at = source.lastIndexOf("...{CONTROL}") + 4;

    const [group] = service.getDocumentHighlights(spelled, at, [spelled]) ?? [];
    if (group === undefined) throw new Error("no highlights");

    for (const span of group.highlightSpans) {
      expect(source.slice(span.textSpan.start, span.textSpan.start + span.textSpan.length)).toBe("CONTROL");
    }
  });
});

describe("going to a binding a block reads", () => {
  const source =
    `/**\n * A paragraph of comment, long enough that landing on it is unmistakable.\n *\n * A second one, for the same reason.\n */\nconst CONTROL = @@( color: red; );\n\n` +
    `const card = @@(\n  ...{CONTROL};\n  padding: 8px;\n);\n`;

  test("lands on the declaration, not on the comment above it", () => {
    const { service } = editor(source);
    const at = source.indexOf("...{CONTROL}") + 4;

    const [only] = service.getDefinitionAtPosition(FILE, at) ?? [];
    if (only === undefined) throw new Error("no definition");

    expect(source.slice(only.textSpan.start, only.textSpan.start + only.textSpan.length)).toBe("CONTROL");
  });

  /**
   * The same, with the comment above it holding text that LOOKS like a block.
   *
   * This is the shape the user actually had: `panels.tsx` explains the syntax in its own JSDoc, so
   * the paragraph above the declaration contains `...{ … }` and `@@if ({ … }) { … }` as prose. If
   * any scanner reads a comment as a site, every position after it shifts — and the symptom is a
   * definition landing a few characters early, which is exactly what was reported.
   */
  test("even when the comment above it explains the syntax", () => {
    const explained =
      `/**\n * A block, explained.\n *\n * \`...{ … }\` merges another block here, and \`@@if ({ … }) { … }\` merges a group.\n *\n * Spreading a lookup — \`...{TONES[this.tone]}\` — is exhaustive.\n */\nconst CONTROL = @@( color: red; );\n\n` +
      `const card = @@(\n  ...{CONTROL};\n  padding: 8px;\n);\n`;
    const { service } = editor(explained);
    const at = explained.lastIndexOf("...{CONTROL}") + 4;

    const [only] = service.getDefinitionAtPosition(FILE, at) ?? [];
    if (only === undefined) throw new Error("no definition");

    expect(explained.slice(only.textSpan.start, only.textSpan.start + only.textSpan.length)).toBe("CONTROL");
  });

  test("and the bound span covers the name under the cursor", () => {
    const { service } = editor(source);
    const at = source.indexOf("...{CONTROL}") + 4;

    const got = service.getDefinitionAndBoundSpan(FILE, at);
    if (got === undefined) throw new Error("no bound span");

    expect(source.slice(got.textSpan.start, got.textSpan.start + got.textSpan.length)).toBe("CONTROL");
  });
});

/**
 * `optionalReplacementSpan`, which is the span an editor REPLACES when a completion is accepted.
 *
 * **Reported by a user as "no completion inside an `@@if` group", and it took eleven measurements to
 * find because the entries were always right.** The list came back with all 551 properties and the
 * one they wanted among them; what was wrong was the span beside it.
 *
 * Every other span this proxy returns is mapped back out of the virtual file — `entry.replacementSpan`
 * on the line below, `textSpan` in `getDefinitionAndBoundSpan`, and so on. This one arrived through
 * `...got` and was handed on with the VIRTUAL file's coordinates, which point at unrelated characters
 * in the author's:
 *
 *     inside an `@@if` group, typing `op`     the span covered `dd`
 *     at the top of a block, typing `dis`     the span covered `ip}>flip the tone<`
 *
 * The caret is outside a span like that, so an editor is entitled to drop the list — and VS Code
 * did, in the group, while recovering at the top of a block. That difference is why it looked like
 * groups were special when nothing about the group was involved.
 */
describe("the span a completion replaces", () => {
  test.each([
    ["at the top of a block", `const a = <div css=@@(\n  dis${CARET}\n)>x</div>;\n`, "dis"],
    ["after a declaration", `const a = <div css=@@(\n  display: flex;\n  op${CARET}\n)>x</div>;\n`, "op"],
    ["inside an `@@if` group", `const a = <div css=@@(\n  @@if ({on}) {\n    op${CARET}\n  }\n)>x</div>;\n`, "op"],
    [
      "second in an `@@if` group",
      `const a = <div css=@@(\n  @@if ({on}) {\n    opacity: 0.5;\n    cu${CARET}\n  }\n)>x</div>;\n`,
      "cu",
    ],
    ["inside a nested rule", `const a = <div css=@@(\n  &:hover {\n    cu${CARET}\n  }\n)>x</div>;\n`, "cu"],
  ])("%s covers what was typed", (_what, marked, typed) => {
    const { service, source, caret } = editor(marked);
    const got = service.getCompletionsAtPosition(FILE, caret, undefined);
    if (got === undefined) throw new Error("no completions");

    const span = got.optionalReplacementSpan;
    if (span === undefined) throw new Error("no optionalReplacementSpan");

    // The characters the editor would replace are the ones the author is typing over.
    expect(source.slice(span.start, span.start + span.length)).toBe(typed);
    // And the caret is inside it, which is what an editor checks before it shows the list at all.
    expect(span.start + span.length).toBe(caret);
  });
});

/**
 * And no span may reach past the line the caret is on.
 *
 * **Found while fixing the one above, and it is the worse of the two**: a span that is merely absent
 * costs a completion, and a span that is too LONG deletes code. Measured on the real file, typing
 * `dis` at the top of a block came back with a span of seventeen characters — `dis`, the newline, and
 * the `...` of the spread below it. Accepting `display` would have left:
 *
 *     display{CONTROL};
 *
 * with the spread's own line gone. The cause is the tolerant reading: a declaration with no colon
 * becomes a quoted key, and the quote runs to the end of what it can take.
 *
 * A property name never contains a newline, so a span that does is not a name and is dropped —
 * the editor then replaces the word under the caret, which is what it does with no span at all.
 */
describe("a span that would eat the line below", () => {
  test.each([
    ["at the top of a block, above a spread", `const a = <div css=@@(\n  dis${CARET}\n  ...{base};\n)>x</div>;\n`],
    ["above another declaration", `const a = <div css=@@(\n  dis${CARET}\n  color: red;\n)>x</div>;\n`],
    ["above a nested rule", `const a = <div css=@@(\n  dis${CARET}\n  &:hover { color: red; }\n)>x</div>;\n`],
    ["above the block's own close", `const a = <div css=@@(\n  dis${CARET}\n)>x</div>;\n`],
  ])("%s", (_what, marked) => {
    const { service, source, caret } = editor(marked);
    const got = service.getCompletionsAtPosition(FILE, caret, undefined);
    if (got === undefined) throw new Error("no completions");

    for (const span of [got.optionalReplacementSpan, got.entries.find((e) => e.name === "display")?.replacementSpan]) {
      if (span === undefined) continue;
      expect(source.slice(span.start, span.start + span.length)).not.toContain("\n");
    }
  });

  /** And what the editor would be left with, which is the fault stated as a fault. */
  test("accepting a completion does not take the line below with it", () => {
    const marked = `const a = <div css=@@(\n  dis${CARET}\n  ...{base};\n)>x</div>;\n`;
    const { service, source, caret } = editor(marked);
    const got = service.getCompletionsAtPosition(FILE, caret, undefined);
    const entry = got?.entries.find((one) => one.name === "display");
    if (entry === undefined) throw new Error("no `display`");

    const span = entry.replacementSpan ?? got?.optionalReplacementSpan;
    const applied =
      span === undefined
        ? source
        : source.slice(0, span.start) + (entry.insertText ?? entry.name) + source.slice(span.start + span.length);

    expect(applied).toContain("...{base};");
  });
});

/**
 * A caret on a blank line at the END of a block, or of a group inside one.
 *
 * **The user's actual fault, and it took thirteen measurements to corner** because every reduced
 * fixture put the blank line BETWEEN two declarations, where it works. At the end of a group it does
 * not: the virtual file closed `__block([…])` before the author's trailing newlines and emitted them
 * after it, so a caret there was outside the call — in the JSX — and TypeScript answered with its
 * globals instead of the properties.
 *
 * Measured on the user's own file: 81 completions with no `cursor` and no `display` among them, where
 * the line above gave 551 with both.
 *
 * The blank line a person is about to type on is exactly where completion is wanted, so this is not
 * an edge: it is what pressing Enter does.
 */
describe("a caret on a blank line at the end", () => {
  test.each([
    ["of a block", `const a = <div css=@@(\n  display: flex;\n  ${CARET}\n)>x</div>;\n`],
    ["of a block, with nothing on the line", `const a = <div css=@@(\n  display: flex;\n${CARET}\n)>x</div>;\n`],
    [
      "of an `@@if` group",
      `const a = <div css=@@(\n  @@if ({on}) {\n    opacity: 0.5;\n    ${CARET}\n  }\n)>x</div>;\n`,
    ],
    [
      "of a group, two blank lines and stray spaces",
      `const a = <div css=@@(\n  @@if ({on}) {\n    opacity: 0.5;\n\n      ${CARET}\n\n  }\n)>x</div>;\n`,
    ],
    ["of a nested rule", `const a = <div css=@@(\n  &:hover {\n    color: red;\n    ${CARET}\n  }\n)>x</div>;\n`],
  ])("%s offers the property names", (_what, marked) => {
    const offered = names(marked);

    expect(offered.length).toBeGreaterThan(400);
    for (const property of SOME_PROPERTIES) expect(offered).toContain(property);
  });
});

/**
 * Hover, where the answer used to be about the virtual file rather than about CSS.
 *
 * **Reported by a user**: hovering `::after` showed
 * `(property) "&::after": ({ content: string } | …)[]`, which is a true sentence about the object
 * literal the virtual file builds and tells a reader nothing. Measured, three shapes were wrong in
 * two different ways:
 *
 *     display, content    CSS grammar plus Initial/Inherited     already right
 *     ::after, :hover     (property) "&::after": {               noise
 *     @media (…)          (property) "@media (…)": {             noise
 *     @@if, ...           nothing at all
 *
 * A property already answers well because `asCss` reshapes what the generated types carry. A
 * selector, an at-rule and this language's own markers had nobody to answer for them.
 *
 * ## What is generated and what is written
 *
 * `mdn-data` has 144 selectors with their group and their MDN url and **no description** — so the
 * NAMES are generated, and the sentences are written for the ones whose behaviour surprises people.
 * The generator asserts every written name exists in `mdn-data`, so a sentence cannot be attached to
 * a selector CSS does not have.
 *
 * `@@if` and `...` are this language's own and have no upstream to read; what they say is what this
 * repository measured about them.
 */
describe("hover", () => {
  const hovered = (code: string, at: string) => {
    const { service, source } = editor(code);
    const got = service.getQuickInfoAtPosition(FILE, source.indexOf(at) + 1);
    return {
      signature: got?.displayParts?.map((one) => one.text).join("") ?? "",
      documentation: got?.documentation?.map((one) => one.text).join("") ?? "",
    };
  };

  const BLOCK =
    `const a = <div css=@@(\n` +
    `  display: flex;\n` +
    `  &::after { content: ""; }\n` +
    `  &:hover { color: red; }\n` +
    `  @@if ({on}) { opacity: 0.5; }\n` +
    `  ...{base};\n` +
    `  @media (min-width: 40rem) { gap: 8px; }\n` +
    `)>x</div>;\n`;

  test("a pseudo-element says what it is, and what it needs", () => {
    const { signature, documentation } = hovered(BLOCK, "::after");

    expect(signature).toContain("::after");
    expect(signature).not.toContain("(property)");
    expect(documentation).toContain("content");
  });

  test("a pseudo-class says what it is", () => {
    const { signature, documentation } = hovered(BLOCK, ":hover");

    expect(signature).toContain(":hover");
    expect(signature).not.toContain("(property)");
    expect(documentation).not.toBe("");
  });

  test("and carries the MDN link, which is where the rest of it is", () => {
    expect(hovered(BLOCK, "::after").documentation).toContain("developer.mozilla.org");
  });

  test("`@@if` says what a group does", () => {
    const { signature, documentation } = hovered(BLOCK, "@@if");

    expect(signature).toContain("@@if");
    expect(documentation).toContain("later");
  });

  test("`...` says what a spread does", () => {
    const { signature } = hovered(BLOCK, "...{base}");

    expect(signature).toContain("...");
  });

  test("an at-rule condition says which at-rule it is", () => {
    const { signature } = hovered(BLOCK, "@media");

    expect(signature).toContain("@media");
    expect(signature).not.toContain("(property)");
  });

  /**
   * And it carries the at-rule's own link. All 19 at-rules in `mdn-data` have one, so this needs no
   * sentence written for it — the condition a person hovers is already the specific question, and
   * the link is where the answer to it lives.
   */
  test("and the at-rule's MDN link, which is generated rather than written", () => {
    const { documentation } = hovered(BLOCK, "@media");

    expect(documentation).toContain("developer.mozilla.org/docs/Web/CSS/@media");
  });

  test.each([
    ["@supports", `const a = <div css=@@(\n  @supports (display: grid) { gap: 8px; }\n)>x</div>;\n`],
    ["@container", `const a = <div css=@@(\n  @container (min-width: 20rem) { gap: 8px; }\n)>x</div>;\n`],
  ])("%s too", (name, code) => {
    const { signature, documentation } = hovered(code, name);

    expect(signature).toContain(name);
    expect(documentation).toContain(`developer.mozilla.org/docs/Web/CSS/${name}`);
  });

  /** An at-rule nobody has heard of shows its own text, which is still the honest answer. */
  test("and one with no entry shows its own text", () => {
    const { signature } = hovered(`const a = <div css=@@(\n  @invented (x) { gap: 8px; }\n)>x</div>;\n`, "@invented");

    expect(signature).toContain("@invented");
  });

  /** What already worked must keep working — the reason the property path is untouched. */
  test("a property still shows its grammar and its initial value", () => {
    const { signature, documentation } = hovered(BLOCK, "display");

    expect(signature).toContain("display:");
    expect(documentation).toContain("Initial");
  });

  test("and so does a value, through the declaration it belongs to", () => {
    expect(hovered(BLOCK, "flex").signature).toContain("display:");
  });
});

/**
 * WHICH config the editor measures a file against — the fourth answer to one question.
 *
 * A review found this walking up from `host.getCurrentDirectory()`, which for a monorepo opened at
 * its root is one config for files that have their own. So the squiggles an author sees need not be
 * the units the build enforces, and nothing says which of the two is in force. The file is the
 * anchor now, the same as in `check.ts`, `vite.ts` and `esbuild.ts`; see `configReader`.
 */
describe("which config the editor measures a file against", () => {
  const monorepo = () => {
    const repo = mkdtempSync(join(tmpdir(), "ramonda-editor-which-"));
    mkdirSync(join(repo, ".git"), { recursive: true });
    for (const name of ["web", "admin"]) mkdirSync(join(repo, "packages", name), { recursive: true });
    writeFileSync(join(repo, "packages", "web", "ramonda.css.ts"), `export default { units: ["px"] };\n`);
    writeFileSync(join(repo, "packages", "admin", "ramonda.css.ts"), `export default { units: ["px", "em"] };\n`);
    const source = `const a = <div css=@@(\n  padding: 1em;\n)>x</div>;\nexport default a;\n`;
    for (const name of ["web", "admin"]) writeFileSync(join(repo, "packages", name, "Card.tsx"), source);
    writeFileSync(join(repo, "jsx.d.ts"), JSX_TYPES);
    return repo;
  };

  /** An editor opened at `cwd`, holding both packages' files. */
  const opened = (repo: string, cwd: string) => {
    const files = [join(repo, "packages", "web", "Card.tsx"), join(repo, "packages", "admin", "Card.tsx")];
    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => [...files, join(repo, "jsx.d.ts")],
      getScriptVersion: () => "1",
      getScriptSnapshot: (name) => {
        const text = ts.sys.readFile(name);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => cwd,
      getCompilationSettings: () => ({
        jsx: ts.JsxEmit.Preserve,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: [],
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      }),
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };
    const inner = ts.createLanguageService(host);
    return init({ typescript: ts }).create({
      languageService: inner,
      languageServiceHost: host,
      config: { properties: join(PACKAGE, "src", "properties") },
    });
  };

  test("the file's own package, not the folder the editor was opened at", () => {
    const repo = monorepo();
    // Opened at the repository root, where there is no config at all.
    const service = opened(repo, repo);

    const said = service
      .getSemanticDiagnostics(join(repo, "packages", "web", "Card.tsx"))
      .map((one) => ts.flattenDiagnosticMessageText(one.messageText, " "));

    expect(said.join("\n")).toContain("`em` is a CSS unit this project does not use");
  });

  test("and the package next door keeps its own answer, in the same session", () => {
    const repo = monorepo();
    const service = opened(repo, repo);

    const said = service
      .getSemanticDiagnostics(join(repo, "packages", "admin", "Card.tsx"))
      .map((one) => ts.flattenDiagnosticMessageText(one.messageText, " "));

    expect(said.join("\n")).not.toContain("CSS unit");
  });
});
