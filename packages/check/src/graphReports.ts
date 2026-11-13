import type { AnalyzeResult } from "./analyze";

/**
 * The faults computed from the whole graph rather than by a rule — a consumer with no provider, a
 * component nothing can follow, a route table nothing mounts — each said once, as a rule says its own.
 *
 * They were printed by hand in `cli.ts`, a block of `console.error` each. Then the run grew a second
 * reader, `--json`, and a second copy of every sentence is the shape this repository keeps being
 * bitten by. So each is described here, in the same three parts a rule's report has, and both the
 * text and the JSON are read from it.
 *
 * In the order the run prints them. `lines` is what follows an item's `file:line:column`.
 */
export interface GraphReport<T> {
  /** Stable, kebab-case — what `--json` calls the finding, as a rule's id is. */
  id: string;
  items(result: AnalyzeResult): readonly T[];
  heading(count: number): string;
  lines(item: T): string[];
  advice?: string;
}

type Item<K extends keyof AnalyzeResult> = AnalyzeResult[K] extends readonly (infer T)[] ? T : never;

const report = <K extends keyof AnalyzeResult>(
  key: K,
  described: Omit<GraphReport<Item<K>>, "items">,
): GraphReport<Item<K>> => ({ ...described, items: (result) => result[key] as unknown as readonly Item<K>[] });

export const GRAPH_REPORTS = [
  /**
   * The strict rule: a component this cannot follow is an ERROR.
   *
   * The walk goes quiet below a name it cannot resolve, so everything under it is unjudged and the
   * build passes over a page that may be broken. A map with unmarked blanks is worse than no map,
   * because it is trusted. Whatever this cannot resolve, a bundler could not have code-split either.
   */
  report("unresolved", {
    id: "unresolved-component",
    heading: (n) => `${n} place(s) naming a component that cannot be followed`,
    lines: (hole) => [
      `    through \`${hole.what}\` — ${hole.why}`,
      "",
      ...hole.fix.split("\n").map((line) => `      ${line}`),
    ],
    advice:
      `Nothing below one of these is judged, so a broken page can pass. If the source is right and\n` +
      `this is the one that cannot see it, write the reason on the line — it is listed on every run:\n\n` +
      `    // ramonda-check-ignore the chunk is deliberately missing, to demonstrate the failure\n`,
  }),

  /**
   * The first rule computed from the graph rather than from the source.
   *
   * The walk visits everything a root mounts, so what it never arrived at is what nothing mounts. An
   * EXPORTED one is left alone: an app is entered through what it publishes, and an SSR entry is
   * called by the server rather than by this program.
   */
  report("unreachable", {
    id: "unreachable-declaration",
    heading: (n) => `${n} declaration(s) no root reaches`,
    lines: (dead) => [`    ${dead.name} — nothing mounts this ${dead.kind}, on any path from any root.`],
    advice:
      `Delete it, or mount it. Nothing outside its own file can even name it, so no import\n` +
      `elsewhere is keeping it alive — and an EXPORTED one is never reported, because an app is\n` +
      `entered through what it publishes and this cannot see who does the entering.\n`,
  }),

  /** A whole section of a site that can never appear, which each page on its own gives no sign of. */
  report("unreachableRoutes", {
    id: "unreachable-route-table",
    heading: (n) => `${n} route table(s) whose views can never appear`,
    lines: (table) => [
      table.why === "unmounted"
        ? `    ${table.views} view(s), and no <RouteOutlet> in this build is handed this table.`
        : `    ${table.views} view(s), and no root reaches the <RouteOutlet> that mounts them.`,
    ],
    advice:
      `Hand the table to a <RouteOutlet>, and mount that outlet somewhere a root can reach —\n` +
      `or delete the table. Every page in it renders today's nothing, and each one on its own\n` +
      `looks perfectly well formed, which is why nothing else says a word.\n`,
  }),

  /**
   * The other read the runtime throws on, and the one nothing else can see.
   *
   * Two faults printed as one section because they are the same mistake at two distances, and each
   * line says which it is: nothing routes to this component at all, or something does and it is a
   * different route from the one the read names. The router's own two messages make the same split.
   */
  report("paramsOffRoute", {
    id: "params-off-route",
    heading: (n) => `${n} params(pattern) read(s) the routing cannot answer`,
    lines: (read) => [
      // The path from a root, because the READ may be in a package the reader cannot edit — and then
      // the line to change is the mount, which is the only part of this that is theirs.
      ...(read.path.length > 1 ? [`    ${read.path.join(" > ")}`] : []),
      read.why === "no-outlet"
        ? `    <${read.component}> reads \`${read.member}.params("${read.pattern}")\`, and no arrangement in ` +
          `this build puts it under a <RouteOutlet>.`
        : `    <${read.component}> reads \`${read.member}.params("${read.pattern}")\`, but the route that ` +
          `mounts it is "${read.route}", which supplies no ${(read.missing ?? []).map((name) => `\`:${name}\``).join(", ")}.`,
    ],
    advice:
      `Params are published by the outlet that MATCHED, and each outlet publishes only its own — so a\n` +
      `component reads the pattern of the route that mounts IT, and chrome beside the outlet (a nav\n` +
      `bar, a header, a footer) has a pathname and no params at all. The router throws on both of\n` +
      `these in every build.\n\n` +
      `Name the route this component is really rendered by, or move the read into the page that is\n` +
      `on that route and pass the value down as a prop. Use \`pathname\` if it is not part of a route,\n` +
      `and \`params<T>()\` with no argument when it is genuinely written against no ONE route.\n`,
  }),

  /**
   * The other door, printed apart from the first because the fix is a different sentence.
   *
   * A pattern read that goes wrong THROWS at runtime; a claimed key that goes wrong hands back
   * `undefined` where the type promised a string. So this says what the read will actually do, and
   * names the honest spelling — an optional key — rather than only refusing.
   */
  report("keysOffRoute", {
    id: "keys-off-route",
    heading: (n) => `${n} params() read(s) claiming a key the routing does not supply`,
    lines: (read) => {
      const claimed = read.keys.map((name) => `\`${name}\``).join(", ");
      const absent = (read.missing ?? read.keys).map((name) => `\`${name}\``).join(", ");
      return [
        ...(read.path.length > 1 ? [`    ${read.path.join(" > ")}`] : []),
        read.why === "no-outlet"
          ? `    <${read.component}> reads \`${read.member}.params()\` for ${claimed}, and no arrangement in ` +
            `this build puts it under a <RouteOutlet> — so the params are empty and ${claimed} ` +
            `${read.keys.length === 1 ? "is" : "are"} \`undefined\`. This read does not throw, which is why ` +
            `nothing has told you.`
          : `    <${read.component}> reads \`${read.member}.params()\` for ${claimed}, but the route that ` +
            `mounts it is "${read.route}", which supplies no ${absent}. The read gives \`undefined\` where ` +
            `the type says \`string\`, without throwing. Name the pattern instead, or mark the key optional ` +
            `if this component really is rendered by routes that disagree.`,
      ];
    },
  }),

  /**
   * A route that exists only under a condition, linked to from code that is not under it — the
   * router's `DESIGN-module-routes.md`, section 3. The type cannot say it: the compiler reads one
   * program, where the condition is a `boolean`, so the route is in the type in every build.
   */
  report("linksToConditionalRoutes", {
    id: "link-to-a-conditional-route",
    heading: (n) => `${n} link(s) to a route that exists only under a condition`,
    lines: (link) => {
      const when = link.negated ? `\`${link.condition}\` is false` : `\`${link.condition}\``;
      return [
        `    <${link.component}> links to "${link.href}", and "${link.route}" exists only when ${when} — ` +
          `this link is not under it, so where it does not hold the link lands on the catch-all.`,
      ];
    },
    advice:
      `A part under a condition — \`createRoutes(cond ? debugRoutes : undefined, …)\` — holds routes that\n` +
      `exist only where the condition holds. Put the link under the same condition, the same name or\n` +
      `expression (\`{cond && <Link …/>}\`, \`if (cond) …\`, a \`const\` holding it), or link somewhere every\n` +
      `build has. A link from the part's own pages needs nothing: they are only rendered where the\n` +
      `condition holds.\n\n` +
      `The condition is read where the link is WRITTEN. A guard around the call to a method that holds\n` +
      `the link is not seen — put the condition at the link, or move the link into the part's pages.\n`,
  }),

  /**
   * The runtime throws when this happens. Here it is said before anything renders, on every path the
   * source can produce — including the branch nobody clicked.
   */
  report("secondProviders", {
    id: "second-provider",
    heading: (n) => `${n} second provider(s) for a context that allows one`,
    lines: (second) => [
      `    <${second.provider}> mounts a second "${second.context}", and one is already above it:`,
      `    ${second.path.join(" → ")}`,
    ],
    advice:
      `Mount it once, on a component that wraps the rest. A context whose author wrote\n` +
      `\`single: true\` is one where two CONFLICT rather than the nearer winning — for the\n` +
      `router's, both listen to popstate and both write history.\n`,
  }),

  /**
   * A cycle by itself is not a fault — a tree renders itself for each child and stops when the data
   * runs out. This is the ring where nothing can stop.
   */
  report("renderCycles", {
    id: "render-cycle",
    heading: (n) => `${n} ring(s) of mounts that nothing can skip`,
    lines: (ring) => [`    ${ring.path.join(" → ")}`],
    advice:
      `Every step on this ring runs on EVERY render — no branch, no callback, no loop — so the\n` +
      `first render recurses until the stack gives out, before a page appears. Put the recursion\n` +
      `behind the data that ends it: a condition, or the callback \`list()\` takes.\n`,
  }),

  /**
   * `{Named}` where `<Named />` was meant. It renders nothing and the runtime says nothing, because a
   * class is a function and the check for an object among children never sees it.
   */
  report("classesAsChildren", {
    id: "class-as-child",
    heading: (n) => `${n} component(s) named among children, where an element was meant`,
    lines: (named) => [`    {${named.name}} renders nothing. Write <${named.name} />.`],
    advice:
      `A class among children is dropped, and nothing reports it at run time — the check for an\n` +
      `object that is not markup never sees it, because a class is a function. Handing a component\n` +
      `OVER is an attribute: \`<Slot view={Named} />\` is a binding, not a child.\n`,
  }),

  report("issues", {
    id: "missing-provider",
    heading: (n) => `${n} consumer(s) with no provider above them`,
    lines: (issue) => [
      `    <${issue.consumer}> consumes "${issue.context}" — nothing provides it on this path:`,
      `    ${issue.path.join(" → ")}`,
    ],
    advice:
      `Mount the matching Provider on a component above it — a context reaches only the providing\n` +
      `component and its descendants. This ran before the app did, so nothing had to render for it\n` +
      `to be found.\n`,
  }),
] as const;

/** Any one of them, for a loop that does not care which. */
export type AnyGraphReport = GraphReport<{ file: string; line: number; column: number }>;
