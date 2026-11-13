import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { JsonFinding } from "@ramonda/check";
import ts from "typescript";

/**
 * The type check a generated project's build runs after `ramonda-check`, over code that may not be
 * saved yet — the half of the build's verdict `ramonda-check` deliberately does not give, because it
 * does not type-check.
 *
 * Two of them, and the app decides which, as its `typecheck` script does: an app with style blocks
 * runs `ramonda-css` (the compiler cannot read a block), every other app runs `tsc --noEmit`. The CSS
 * one is the APP's own installed copy, so the answer is its build's, version for version.
 */
export interface TypeCheck {
  findings: JsonFinding[];
  /** Something the run could not do, said rather than skipped. */
  notes: string[];
}

/** The `package.json` that owns a tsconfig: the nearest one above it. */
function appManifest(tsconfig: string): string | undefined {
  for (let at = dirname(tsconfig); ; at = dirname(at)) {
    const file = join(at, "package.json");
    if (existsSync(file)) return file;
    if (dirname(at) === at) return undefined;
  }
}

/** Whether the app depends on `@ramonda/css` — which is what makes its `typecheck` script `ramonda-css`. */
function usesStyleBlocks(manifest: string | undefined): boolean {
  if (manifest === undefined) return false;
  const json = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, Record<string, string> | undefined>;
  return ["dependencies", "devDependencies"].some((field) => json[field]?.["@ramonda/css"] !== undefined);
}

/**
 * The app's own `@ramonda/css/check`, found the way Node finds a package — the nearest
 * `node_modules/@ramonda/css` above the app — and then through its `exports`.
 *
 * Not `require.resolve`: the entry is ESM only, and a require resolves only the `require` and
 * `default` conditions, so it reported "not installed" about a package that was.
 */
function cssCheckFrom(appDir: string): string | undefined {
  for (let at = appDir; ; at = dirname(at)) {
    const root = join(at, "node_modules", "@ramonda", "css");
    const manifest = join(root, "package.json");
    if (existsSync(manifest)) {
      const json = JSON.parse(readFileSync(manifest, "utf8")) as { exports?: Record<string, { import?: string }> };
      const entry = json.exports?.["./check"]?.import;
      return entry === undefined ? undefined : join(root, entry);
    }
    if (dirname(at) === at) return undefined;
  }
}

/** A path as the compiler spells it — absolute, forward slashes. */
const spelled = (path: string) => resolve(path).split(sep).join("/");

/**
 * Type-check the project with `files` laid over the disk, and keep what `only` names — every file
 * when it is undefined.
 */
export async function typeCheck(
  tsconfig: string,
  files: Readonly<Record<string, string>> = {},
  only?: string,
): Promise<TypeCheck> {
  const manifest = appManifest(tsconfig);
  const mine = (file: string | undefined) =>
    only === undefined || (file !== undefined && spelled(file) === spelled(only));

  if (usesStyleBlocks(manifest)) {
    const entry = cssCheckFrom(dirname(manifest as string));
    if (entry === undefined) {
      // A FINDING, not a note: a check that did not run must not read as one that passed.
      return {
        findings: [
          {
            code: "type-check-not-run",
            severity: "error",
            file: manifest,
            message:
              "This app names @ramonda/css, and no @ramonda/css with a `check` entry is installed for it, so the " +
              "types were not checked. Install it, or update it to the release @ramonda/mcp came with.",
          },
        ],
        notes: [],
      };
    }
    const { cssReport } = (await import(pathToFileURL(entry).href)) as typeof import("@ramonda/css/check");
    const report = cssReport(tsconfig, { files, only: only === undefined ? undefined : [only] });
    return { findings: report.findings.filter((finding) => mine(finding.file)), notes: [] };
  }
  return { findings: plainTypeCheck(tsconfig, files, only).filter((finding) => mine(finding.file)), notes: [] };
}

/** `tsc --noEmit`, over the disk with `files` laid on it. */
function plainTypeCheck(tsconfig: string, files: Readonly<Record<string, string>>, only?: string): JsonFinding[] {
  const read = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (read.error !== undefined) return [found(read.error)];
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(tsconfig), undefined, tsconfig);
  if (parsed.errors.length > 0) return parsed.errors.map(found);

  const inMemory = new Map(Object.entries(files).map(([path, text]) => [spelled(path), text]));
  const options = { ...parsed.options, noEmit: true };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (name) => inMemory.get(spelled(name)) ?? readFile(name);
  host.fileExists = (name) => inMemory.has(spelled(name)) || fileExists(name);
  host.getSourceFile = (name, language, onError, shouldCreate) => {
    const text = inMemory.get(spelled(name));
    return text === undefined
      ? getSourceFile(name, language, onError, shouldCreate)
      : ts.createSourceFile(name, text, language, true);
  };
  const program = ts.createProgram({
    rootNames: [...new Set([...parsed.fileNames, ...inMemory.keys()])],
    options,
    host,
    projectReferences: parsed.projectReferences,
  });
  // One file's check when one is asked about — the compiler checks a single file of a program.
  const asked = only === undefined ? undefined : program.getSourceFile(spelled(only));
  return (
    only === undefined
      ? ts.getPreEmitDiagnostics(program)
      : asked === undefined
        ? []
        : ts.getPreEmitDiagnostics(program, asked)
  ).map(found);
}

/** A diagnostic as `ramonda-css --json` writes one: `TS2322`, where it is, the whole message. */
function found(diagnostic: ts.Diagnostic): JsonFinding {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return { code: `TS${diagnostic.code}`, severity: "error", message };
  }
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return {
    code: `TS${diagnostic.code}`,
    severity: "error",
    file: diagnostic.file.fileName,
    line: line + 1,
    column: character + 1,
    message,
  };
}
