import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import ts from "typescript";
import type { ComponentGraph } from "./graph";

/**
 * A package's own graph, read by an app that compiles against its `dist`.
 *
 * **Why a fragment and not a summary.** A summary would say `DataGrid requires Query`, and the app
 * would have to trust it. A fragment carries the package's internals too, so the app splices the
 * subgraph in and walks it — and the report names the real path, `App > DataGrid > PagedBody`,
 * which is the most useful half of a diagnostic. There is also no transitive closure to compute,
 * and nothing to keep in step with the source.
 *
 * The cost is a bigger file and internal component names appearing in it. The second is not a
 * secret: those names are in the bundle already.
 */

/** What a package's `package.json` says about its graph. */
export function graphPathOf(packageRoot: string): string | undefined {
  const raw = ts.sys.readFile(`${packageRoot}/package.json`);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { ramonda?: { graph?: string } };
    const declared = parsed.ramonda?.graph;
    if (!declared) return undefined;
    return isAbsolute(declared) ? declared : resolve(packageRoot, declared);
  } catch {
    return undefined;
  }
}

export interface LoadedFragment {
  graph: ComponentGraph;
  /** Where it was read from, for a message that has to name a file. */
  file: string;
}

/**
 * Reads a fragment and refuses it unless it describes the code actually installed.
 *
 * A stale fragment is the exact failure this whole design calls worse than no map: one that is
 * trusted. The source hash cannot help here — the app has `dist` and nothing else — so the
 * fragment fingerprints the declaration file the app imports, and that is what is checked.
 */
export function loadFragment(
  packageRoot: string,
  packageName: string,
): { fragment?: LoadedFragment; refused?: string } {
  const file = graphPathOf(packageRoot);
  if (!file) return {};
  const raw = ts.sys.readFile(file);
  if (!raw) return { refused: `${packageName} declares a graph at ${file}, and there is no file there` };

  let graph: ComponentGraph;
  try {
    graph = JSON.parse(raw) as ComponentGraph;
  } catch {
    return { refused: `${packageName}'s graph at ${file} is not readable JSON` };
  }

  if (graph.schema !== 1) {
    return { refused: `${packageName}'s graph is schema ${String(graph.schema)}, and this reads schema 1` };
  }
  if (graph.scope !== "library") {
    return {
      refused: `${packageName}'s graph is an app's, not a library's — an app produces the verdict, it does not lend one`,
    };
  }
  if (graph.package?.name !== packageName) {
    return { refused: `${packageName}'s graph says it belongs to ${String(graph.package?.name)}` };
  }

  const describes = graph.describes;
  if (!describes) {
    return {
      refused: `${packageName}'s graph does not say which file it describes, so nothing can tell whether it is stale`,
    };
  }
  const described = resolve(packageRoot, describes.file);
  const content = ts.sys.readFile(described);
  if (content === undefined) {
    return { refused: `${packageName}'s graph describes ${describes.file}, which is not there` };
  }
  const actual = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (actual !== describes.hash) {
    return {
      refused:
        `${packageName}'s graph describes a ${describes.file} that is no longer the installed one — ` +
        `the package was rebuilt without regenerating its graph`,
    };
  }

  return { fragment: { graph, file } };
}

/** The hash a package writes for the file it describes, at the moment it emits its fragment. */
export function fingerprint(file: string): string | undefined {
  const content = ts.sys.readFile(file);
  return content === undefined ? undefined : `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/** The declaration file a package publishes, from `types` or the `exports` map. */
export function declarationEntryOf(packageRoot: string): string | undefined {
  const raw = ts.sys.readFile(`${packageRoot}/package.json`);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      types?: string;
      typings?: string;
      exports?: Record<string, { types?: string } | string>;
    };
    const fromExports = parsed.exports?.["."];
    const declared =
      parsed.types ?? parsed.typings ?? (typeof fromExports === "object" ? fromExports.types : undefined);
    return declared ? resolve(packageRoot, declared) : undefined;
  } catch {
    return undefined;
  }
}

/** The nearest directory at or above `from` that holds a `package.json`. */
export function packageRootOf(from: string): string | undefined {
  let dir = dirname(from);
  for (;;) {
    if (ts.sys.fileExists(`${dir}/package.json`)) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}
