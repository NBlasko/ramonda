/**
 * What the route table's TYPE refuses, asserted by compiling.
 *
 * There is nothing to run here: every claim is a `@ts-expect-error` that fails the build if the
 * type stops refusing. `links.test.ts` beside this checks the links written in markdown; these are
 * the ones written in TSX, which it cannot see.
 *
 * ## The fault this exists for
 *
 * `createRoutes` infers its path union from the table's KEYS, and this site built its table in a
 * loop over `Record<string, VNode>` — so `keyof` was `string`, `AnyHref` collapsed to `string`, and
 * every `<Link href>` on the largest app in the repo was unchecked. Measured before it was fixed:
 * `href="/total/nonsense/not/a/route"` compiled.
 *
 * The generator wrote `as const` on the page list already; the annotation `: readonly PageMeta[]`
 * beside it widened the literals straight back. That is the shape to watch for — an `as const` is
 * only as narrow as the annotation next to it lets it be.
 */
import { Link } from "../routes";

export function claims() {
  return (
    <div>
      {/* A path the table names. */}
      <Link href="/">home</Link>
      <Link href="/guide/installation">installation</Link>

      {/* @ts-expect-error — not a path this site has. */}
      <Link href="/total/nonsense/not/a/route">nonsense</Link>

      {/* @ts-expect-error — a real page, misspelled. The whole point of typing the table. */}
      <Link href="/guide/instalation">typo</Link>
    </div>
  );
}
