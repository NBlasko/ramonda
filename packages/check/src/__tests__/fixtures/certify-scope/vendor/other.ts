import { bootstrap } from "@ramonda/core";

/**
 * A DIFFERENT package inside the same program — its own `package.json` is what makes it one.
 *
 * This is the shape the certificate's scoping exists for, measured on the real repository before
 * it did: `@ramonda/form`, `@ramonda/query` and `@ramonda/router` each reported two written
 * exemptions, and all six were the same two lines in `@ramonda/testing-library`, dragged into their
 * programs by their test files. Three packages would have carried somebody else's excuse.
 *
 * Nested rather than beside, on purpose. A prefix test on the path says this file is "inside"
 * `@fixture/certified`, and it is not — which is exactly what `node_modules` under an app looks
 * like. What decides is the nearest `package.json`, not the string.
 *
 * No JSX here: `jsxImportSource` is `".."` relative to the FILE, so a `.tsx` one directory deeper
 * would resolve it to this folder rather than to `fixtures/`. The two faults below need none.
 */
declare const tree: unknown;
declare const another: unknown;

// A hole: nothing can say what this mounts.
bootstrap(tree as never, null);

// ramonda-check-ignore the caller hands us the tree to mount, which is what this helper is for
bootstrap(another as never, null);
