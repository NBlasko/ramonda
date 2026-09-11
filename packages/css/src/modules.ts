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
 * **A miss costs nothing — for the BUILD.** The reference stays a hole, and a hole where `var()`
 * takes a name is reported by `hole-as-a-variable-name`, so the author is told rather than shipped a
 * rule that silently does nothing.
 *
 * **It costs the PAIR, though, and that is the part this got wrong.** The editor resolves with
 * TypeScript's own resolver, so a specifier it resolves and this one misses shows a token resolved
 * in the editor and refuses the same character in the build. A review found exactly that:
 * `import { accent } from "./theme.js"` — the spelling `moduleResolution: node16` and `nodenext`
 * make MANDATORY — resolved to `theme.ts` in the editor and to nothing here.
 *
 * So a `.js`, `.mjs` or `.cjs` extension is rewritten to its TypeScript sibling first, which is what
 * TypeScript itself does, before the plain candidates are tried. `readModule.test.ts` asserts the two
 * halves agree rather than asserting a list, because a list is the thing that drifts.
 */
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx", ".js", ".jsx"];

/** What TypeScript rewrites a written extension to, before it looks for the file. */
const REWRITTEN: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx", ".d.ts"],
  ".jsx": [".tsx", ".d.ts"],
  ".mjs": [".mts", ".d.mts"],
  ".cjs": [".cts", ".d.cts"],
};

export function readModule(specifier: string, from: string): string | undefined {
  if (from === "") return undefined;
  const base = resolve(dirname(from), specifier);

  const written = /\.[cm]?jsx?$/.exec(base)?.[0];
  if (written !== undefined) {
    const stem = base.slice(0, -written.length);
    for (const instead of REWRITTEN[written] ?? []) {
      try {
        return readFileSync(`${stem}${instead}`, "utf8");
      } catch {
        // The next rewrite. The written extension itself is still tried below, because a project
        // may genuinely be importing a `.js` file that exists.
      }
    }
  }

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
