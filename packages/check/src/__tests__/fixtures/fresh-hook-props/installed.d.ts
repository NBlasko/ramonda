/**
 * A hook reached through a DECLARATION FILE, which is every installed package.
 *
 * A `.d.ts` carries no decorators, so a `@StableProps` the package wrote is invisible from here —
 * `@ramonda/query` declares `key` and `invalidates` exactly that way. A rule that cannot tell a
 * missing declaration from an invisible one may not report either.
 */
export declare class InstalledHook {
  props: { conf: unknown; n: number };
}
