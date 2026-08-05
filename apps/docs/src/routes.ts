import { createRoutes, type RouteConfig } from "@ramonda/router";
import type { VNode } from "@ramonda/core";
import { __h } from "@ramonda/core";
import { pages } from "./generated/content";
import { DocPage } from "./DocPage";

/**
 * The route table, built from the content directory.
 *
 * Every page is the same component with different props, so adding a markdown
 * file adds a route — there is no second list to keep in step with the first.
 * That is also what lets `routePaths()` enumerate the whole site: every path
 * here is literal, so the static build has nothing to be told.
 */
const table: Record<string, VNode> = {};
for (const page of pages) {
  table[page.path] = __h(DocPage, { meta: page }) as VNode;
}
table["*"] = __h(DocPage, { meta: pages[0], notFound: true }) as VNode;

export const routes: RouteConfig = createRoutes(table);
export { pages };
