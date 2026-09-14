/**
 * What a `ramonda.css.ts` imports — and it is a SUBPATH for a reason that was measured.
 *
 * A config is transpiled to CommonJS and `require`d, because that is what makes it loadable inside
 * an editor where no `ts-node` exists — see `readConfig`. The package's main entry is ESM only, on
 * purpose: it is the entry a page loads and it imports nothing. So `import { kind } from
 * "@ramonda/css"` in a config resolved, and then failed:
 *
 *     No "exports" main defined in …/@ramonda/css/package.json
 *
 * Not a test's problem — that is every project's config, in every bundler. This entry is built in
 * both formats, holds nothing but the authoring helpers, and leaves the runtime entry as it was.
 */
export { kind, type Declared, type Kind, type ValueByKind, type Variable } from "./declared";
export type { Config } from "./config";

import type { Config } from "./config";

/**
 * The config, checked as it is written.
 *
 * It returns what it was given and exists for the type alone: a `ramonda.css.ts` is a module with a
 * default export, and an object literal in that position is checked against nothing. Wrapped, a
 * misspelled key, a unit that is not a string and a fallback that is not the kind's are all reported
 * on the line they were written.
 */
export function defineConfig(config: Config): Config {
  return config;
}
