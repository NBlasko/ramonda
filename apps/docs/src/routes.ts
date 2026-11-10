import { createRoutes } from "@ramonda/router";
import { pages } from "./generated/content";
import { table } from "./generated/route-table";

/**
 * The route table, built from the content directory.
 *
 * Every page is the same component with different props, so adding a markdown file adds a route —
 * there is no second list to keep in step with the first. That is also what lets `routePaths()`
 * enumerate the whole site: every path is literal, so the static build has nothing to be told.
 *
 * ## Why the table is generated and not built here in a loop
 *
 * `createRoutes` takes its path union from the table's KEYS, and a loop can only fill a
 * `Record<string, VNode>` — whose key type is `string`. So the loop threw the checking away:
 * `AnyHref` collapsed to `string` and every `<Link href>` on this site was unchecked, measured with
 * `href="/total/nonsense/not/a/route"`, which compiled.
 *
 * **Nothing is annotated here on purpose.** `export const routes: RouteConfig` was the second half
 * of the same fault — the bare `RouteConfig` has `string` for its paths, so an annotation would
 * widen the union straight back after the generator went to the trouble of keeping it.
 * `RouteTypeClaims.tsx` asserts what it refuses.
 */
export const routes = createRoutes(table);
export { pages };

/**
 * The table, registered: every `Link`, `Navigator` and `route()` in this program is checked against
 * it, and each is imported from `@ramonda/router` — never from here, so no page imports this module
 * back.
 */
declare module "@ramonda/router" {
  interface Register {
    routes: typeof routes;
  }
}
