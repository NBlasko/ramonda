import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Reads a module a block imports a named site from, off the disk.
 *
 * This is the BUILD's half of {@link Imported.read}; the editor brings its own, because it has to
 * see what the author has typed and not yet saved.
 *
 * ## The extensions, and why guessing is the honest answer here
 *
 * A bundler's resolver is a large thing — conditions, `exports` maps, `paths`, symlinks — and it is
 * asynchronous in Vite. This transform is synchronous and per-file on purpose, and a resolver would
 * make it neither. So the specifier must be RELATIVE (`namedSites` refuses anything else) and the
 * extension is tried in the order a TypeScript project uses.
 *
 * **A miss costs nothing.** The reference stays a hole, and a hole where `var()` takes a name is
 * reported by `hole-as-a-variable-name` — so the author is told, rather than shipped a rule that
 * silently does nothing. Guessing wrong fails closed.
 */
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx", ".js", ".jsx"];

export function readModule(specifier: string, from: string): string | undefined {
  if (from === "") return undefined;
  const base = resolve(dirname(from), specifier);

  for (const extension of EXTENSIONS) {
    try {
      return readFileSync(`${base}${extension}`, "utf8");
    } catch {
      // The next candidate. A directory, a missing file and a permission error are all "not this
      // one" — and the last of them ends as `undefined`, which is a reference left unresolved.
    }
  }

  return undefined;
}
