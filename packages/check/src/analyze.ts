import { createHash } from "node:crypto";
import { dirname, relative, sep } from "node:path";
import ts from "typescript";
import { declarationEntryOf, fingerprint, loadFragment, packageRootOf } from "./fragment";
import type { ComponentGraph, GraphEdge, GraphNode, Where } from "./graph";
import { hookNamed, isThisUse, positionOf } from "./syntax";
import {
  activate,
  applyClass,
  applyElement,
  applyModule,
  applyTree,
  CLASS_RULES,
  ELEMENT_RULES,
  emptyFindings,
  MODULE_RULES,
  rootsIn,
  TREE_RULES,
} from "./rules";
import type {
  AriaValueIssue,
  AriaWithNoSubjectIssue,
  ArrowFieldIssue,
  BrowserUrlIssue,
  ClassInsteadOfClassNameIssue,
  ClientOnlyRequestReadIssue,
  ClockReadWhileRenderingIssue,
  ContextConsumedAboveItsProviderIssue,
  DomWriteIssue,
  DuplicateDecoratorIssue,
  DuplicateKeyAmongSiblingsIssue,
  DuplicateIdIssue,
  EmptyHeadingOrLinkIssue,
  Findings,
  HeadingSkipsALevelIssue,
  HeadTagsCollideIssue,
  InteractiveInsideInteractiveIssue,
  LateRequestReadIssue,
  PositiveTabIndexIssue,
  RoleMissingRequiredAriaIssue,
  RoleTakesNoNameIssue,
  RowWithoutAKeyIssue,
  StateWrittenWhileRenderingIssue,
  TagNeedsItsParentIssue,
  UnguardedAsyncLifecycleIssue,
  UnknownAriaAttributeIssue,
  UnknownRoleIssue,
  UnnamedFrameIssue,
  UnnamedImageIssue,
  UnsplittableImportIssue,
  UnwatchedFieldIssue,
} from "./rules";

/**
 * The per-class rules, re-exported so that moving them behind `./rules` changed no import anywhere
 * else. Each interface is declared beside the rule that produces it, which is where it belongs —
 * the shape of a finding is part of the rule, not of the analyzer that collects it.
 */

export type {
  AriaValueIssue,
  AriaWithNoSubjectIssue,
  ArrowFieldIssue,
  BrowserUrlIssue,
  ClassInsteadOfClassNameIssue,
  ClientOnlyRequestReadIssue,
  ClockReadWhileRenderingIssue,
  ContextConsumedAboveItsProviderIssue,
  DomWriteIssue,
  DuplicateDecoratorIssue,
  DuplicateKeyAmongSiblingsIssue,
  DuplicateIdIssue,
  EmptyHeadingOrLinkIssue,
  Findings,
  HeadingSkipsALevelIssue,
  HeadTagsCollideIssue,
  InteractiveInsideInteractiveIssue,
  LateRequestReadIssue,
  PositiveTabIndexIssue,
  RoleMissingRequiredAriaIssue,
  RoleTakesNoNameIssue,
  RowWithoutAKeyIssue,
  StateWrittenWhileRenderingIssue,
  TagNeedsItsParentIssue,
  UnguardedAsyncLifecycleIssue,
  UnknownAriaAttributeIssue,
  UnknownRoleIssue,
  UnnamedFrameIssue,
  UnnamedImageIssue,
  UnsplittableImportIssue,
  UnwatchedFieldIssue,
};

/**
 * Proves, before the app is ever opened, that every context consumer has a matching provider
 * ABOVE it — on every path the source can be read to produce.
 *
 * Why static and not only the runtime diagnostic: the runtime one (RMD003) can only speak when a
 * branch actually renders. A consumer behind a condition nobody exercised, or inside a chunk
 * nobody loaded, ships with the fault undetected. The commonest way to get there is a reorder —
 * the provider moves, the consumer stays where it was, and the page still renders because the
 * context quietly falls back to its default.
 *
 * **It only reports what it can prove.** Anything it cannot resolve — a component chosen from a
 * variable, a registry, a prop — makes it go quiet for that path rather than guess. That is what
 * makes it safe to fail a build on: a report here is a real broken path, never a maybe.
 */

export interface ContextIssue {
  /** The context's label, or the consumer binding's name when it has none. */
  context: string;
  /** The component doing the consuming. */
  consumer: string;
  file: string;
  line: number;
  column: number;
  /** Root → … → consumer: the path that has no provider on it. */
  path: string[];
}

/**
 * A place where the source names a component this cannot follow.
 *
 * An ERROR, not a note. The whole value of this tool is that a report is a real broken path rather
 * than a maybe, and that only holds while the map has no unmarked blanks: a walk that goes quiet at
 * a component it could not resolve reports nothing about anything below it, and a build passes over
 * a page that is broken.
 *
 * **The constraint is not this tool's to impose.** A bundler can only split what it can see
 * statically; whatever this cannot resolve, a bundler could not have split either, so the shape was
 * already trouble for another reason.
 */
export interface UnresolvedIssue {
  /** How the component was named — a tag, a route, a loader, `this.use`, a root. */
  what: string;
  /** What could not be followed, said in terms of the source. */
  why: string;
  /** What to write instead: code, not advice. */
  fix: string;
  file: string;
  line: number;
  column: number;
}

/**
 * A site whose author has recorded, in the source, why it cannot be resolved.
 *
 * LINE-SCOPED, never file-scoped, and the reason is mandatory. A file-scoped suppression blinds a
 * whole file with one line, which is exactly what somebody in a hurry reaches for. Every annotated
 * site is listed on every run, so the count cannot grow unnoticed — the escape hatch is a record,
 * not a silence.
 */
export interface AnnotatedSite {
  what: string;
  /** The author's own words. A directive without them is refused. */
  reason: string;
  file: string;
  line: number;
  column: number;
}

/**
 * A component, hook or helper no root can reach.
 *
 * The first rule computed from the graph rather than from the source, and it needs nothing new: the
 * walk already visits everything a root mounts, so what it never arrived at is what nothing mounts.
 *
 * **Only what it can prove.** An EXPORTED one is left alone — an app is entered through what it
 * publishes, and an SSR entry is called by the server rather than by this program, so `renderOne`
 * and `prerender` would be false positives. A class nothing outside its file can even name, that no
 * root reaches, is dead with no room for argument.
 *
 * A library is not judged at all: with no root, nothing in it is reachable by definition.
 */
export interface UnreachableIssue {
  /** The class or function name. */
  name: string;
  kind: "component" | "hook" | "helper";
  file: string;
  line: number;
  column: number;
}

/**
 * A route table whose views can never appear.
 *
 * Two ways to get there, and they read differently to whoever has to fix it: nothing in this run
 * hands the table to a `<RouteOutlet>` at all, or an outlet does but no root reaches that outlet.
 * Either way every page in the table is unreachable — a whole section of a site that renders
 * nothing, which nothing else reports because each page on its own looks perfectly well formed.
 *
 * Read from the graph, like the unreachable declarations: the walk already knows which outlets it
 * arrived at.
 */
export interface UnreachableRouteIssue {
  /** How many views the table declares, which is the size of what cannot appear. */
  views: number;
  /** `unmounted` — no outlet names it; `stranded` — an outlet does, and nothing reaches the outlet. */
  why: "unmounted" | "stranded";
  file: string;
  line: number;
  column: number;
}

/**
 * A second provider for a context whose author declared that two conflict.
 *
 * Nesting is ordinary and the nearest Provider wins — a theme override inside a panel, a form
 * inside a form. `createContext(…, { single: true })` is how an author says this one is different:
 * the router's, where both Routers listen to `popstate` and both write history, so the second is a
 * conflict rather than a narrower scope.
 *
 * The runtime throws when it happens. This says the same thing before anything renders, on every
 * path the source can produce — including the branch nobody clicked, which is the whole reason to
 * read the source at all.
 */
export interface SecondProviderIssue {
  /** The context's label, which is what a message calls it. */
  context: string;
  /** The component mounting the second one. */
  provider: string;
  /** Root → … → that component. */
  path: string[];
  file: string;
  line: number;
  column: number;
}

/**
 * A ring of mounts that nothing on it can skip.
 *
 * A cycle by itself is not a fault — a tree renders itself for each child and stops when the data
 * runs out, which is how a recursive structure is drawn. Measured across this repository: the one
 * cycle in it is a markdown renderer and a code block calling each other, and it is correct.
 *
 * What cannot be correct is a ring where every step runs on EVERY render: no branch, no callback,
 * no loop anywhere on it. Nothing can stop, so the first render recurses until the stack gives out —
 * before a page appears, in every build.
 */
export interface RenderCycleIssue {
  /** The ring, in order, ending where it began. */
  path: string[];
  file: string;
  line: number;
  column: number;
}

/**
 * A component CLASS written among JSX children, where an element was meant.
 *
 * `{Named}` instead of `<Named />`. Measured in core: it renders NOTHING and no diagnostic is
 * emitted — a class is a function rather than an object, so `RMD037` (an object among children that
 * is not markup) never fires, and the page simply comes up without it.
 *
 * There is no arrangement in which this is what somebody meant: the value renders nothing wherever
 * it lands. Handing a component OVER is an attribute — `<Slot view={Named} />` — and that is a
 * binding, not a child.
 */
export interface ClassAsChildIssue {
  /** The component named where an element was meant. */
  name: string;
  file: string;
  line: number;
  column: number;
}

export interface AnalyzeResult {
  issues: ContextIssue[];
  /**
   * What each rule found, keyed by its id — `findings["arrow-fields"]`, `findings["browser-url"]`.
   *
   * This was one named field per rule, and the field was the right shape at five of them. It is not
   * at the number this package is heading for: each rule cost a line in this interface, a line in
   * the CLI's destructure, a report block written by hand, and a clause in the sentence that says
   * everything is fine. Now a rule costs a file.
   *
   * Nothing is lost by the change but the spelling. Each list is still typed as that rule's own
   * issue — `Findings` is derived from the rule registry, so the key and the element type are read
   * off the rule rather than declared a second time here.
   */
  findings: Findings;
  /** Places that name a component this cannot follow — see `UnresolvedIssue`. */
  unresolved: UnresolvedIssue[];
  /** Places where the author has written down why one cannot be followed — see `AnnotatedSite`. */
  annotated: AnnotatedSite[];
  /** Declarations no root reaches — see `UnreachableIssue`. */
  unreachable: UnreachableIssue[];
  /** Route tables whose views can never appear — see `UnreachableRouteIssue`. */
  unreachableRoutes: UnreachableRouteIssue[];
  /** Second providers for a context declared single — see `SecondProviderIssue`. */
  secondProviders: SecondProviderIssue[];
  /** Rings of mounts nothing on them can skip — see `RenderCycleIssue`. */
  renderCycles: RenderCycleIssue[];
  /** Component classes written among children, where an element was meant — see `ClassAsChildIssue`. */
  classesAsChildren: ClassAsChildIssue[];
  counts: { components: number; contexts: number; roots: number };
  /**
   * What can mount what — see `ComponentGraph`.
   *
   * The issues above are one reading of it. It carries the facts they are computed from, including
   * the edges that could not be resolved, so a rule added later needs no second walk of the source.
   */
  graph: ComponentGraph;
  /** What the analyzer could not resolve, so a reader knows where it stayed silent. */
  notes: string[];
}

interface ContextFact {
  id: string;
  /** The node id this context has in the graph — `src/theme.ts#ThemeProvider`. */
  graphId: string;
  at: Where;
  provider?: string;
  consumer?: string;
  label: string;
  /**
   * `createContext(…, { optional: true })` — the author declared the default a real answer, so
   * no provider above is a legitimate arrangement. The runtime says nothing about it either
   * (RMD003), and the two must agree: a build that fails on what the app is documented to do
   * is worse than no check at all.
   */
  optional: boolean;
  /**
   * `createContext(…, { single: true })` — a second one on the same path is a fault rather than an
   * override. Nesting is ordinary and the nearest Provider wins; this is for the context where two
   * conflict, which the router's route context is.
   */
  single: boolean;
}

/** A place where something names a component, and what it resolved to — `undefined` is a hole. */
interface Reference {
  target: ComponentNode | undefined;
  site: ts.Node;
}

/** What a package's fragment contributed, looked up by the name an app imports. */
interface SplicedPackage {
  /** Exported components and hooks, by name — the only ones an app can mount. */
  components: Map<string, ComponentNode>;
  /**
   * The ones an app CANNOT import, by name — a kit's members, handed back through a factory rather
   * than the entry. Kept apart from `components` on purpose: nothing may mount these by writing the
   * name, and only a factory's destructured key may reach them.
   */
  internals: Map<string, ComponentNode>;
  /** Exported context bindings, by the name of either half of the pair. */
  contexts: Map<string, { fact: ContextFact; half: "provides" | "consumes" }>;
}

/** One place that mounts a component, and what that place hands to the component's slots. */
interface MountSite {
  target: ComponentNode;
  /** Whether this site runs on every render — see `GraphEdge.always`. */
  always: boolean;
  /** Slot path → the components handed to it at THIS site; a ternary hands over both arms. */
  binds: Map<string, ComponentNode[]>;
}

interface ComponentNode {
  /**
   * The DECLARATION SITE, which is what a component is identified by.
   *
   * It was the class name, and a name is not an identity: this repository's own documentation app
   * declares `class Page` seventy-five times, one per page, and a name-keyed map made them one node
   * sharing one set of providers, consumers and children. Measured: 146 component and hook classes
   * reported as 72.
   *
   * Everything that names a component — a JSX tag, `__h(X, …)`, a route table, a `lazy` loader,
   * `bootstrap` — is resolved to its symbol and looked up here, so a tag also has to be in scope to
   * match, which a name lookup never checked.
   */
  id: string;
  /**
   * Which of the two base classes the chain reaches, or `helper` for a function that returns JSX.
   *
   * A helper is not a component — nothing mounts it, it has no props and no context of its own —
   * but the tags in its body are edges, and they belong somewhere. They belong to it, and every
   * component that CALLS it reaches them.
   */
  kind: "component" | "hook" | "helper";
  name: string;
  file: string;
  line: number;
  column: number;
  provides: Set<string>;
  /** context id → where it is consumed. */
  consumes: Map<string, { line: number; column: number }>;
  /**
   * One entry per SITE that mounts something, with whatever that site binds to a slot.
   *
   * One entry per site and not a set of targets, because a binding belongs to a call and not to a
   * class: `<Slot view={Reader} />` in one place and `<Slot view={Writer} />` in another are two
   * different arrangements, and collapsing them onto `Slot` would make each reachable from the
   * other — the merge a name-keyed map used to make.
   */
  mounts: MountSite[];
  /**
   * A tag naming a prop — `<this.props.view />` — which nothing can resolve from the class alone.
   * The caller decides, so it is filled from the bindings the walk arrives with.
   */
  slotHoles: { slot: string }[];
  /** Prop paths this component's own type declares as taking a component. */
  slots: string[];
  /**
   * Whether the class carries an `export` modifier — what a library's surface is.
   *
   * The modifier and not the package's entry point: a class re-exported by a barrel with
   * `export { X } from "./x"` reads as internal here, which understates the surface rather than
   * overstating it. Understating costs a report an app could have had; overstating would invite one
   * to mount something the package never published.
   */
  exported: boolean;
  /** Hooks (or components) this one mounts with `this.use(...)`. */
  uses: Set<ComponentNode>;
  /**
   * Set when the class does something the analyzer cannot follow (a provider chosen at runtime).
   * Everything below such a node is left alone — it might be providing anything.
   */
  opaque: boolean;
  /** Whether the class ever mentions `children`, which decides if JSX handed to it can mount. */
  usesChildren: boolean;
}

/**
 * Where a tree starts. The server's three entries are here for the same reason the browser's two
 * are: they are handed a component and they render it.
 *
 * **Leaving them out made an SSR-only app pass in silence**, which is the failure this design is
 * against. Measured on one file with a consumer and no provider above it: written with
 * `bootstrap(<App />, null)` the run names the broken path; change that one line to
 * `renderToString(<App />)` and the same code comes out as "0 root(s) — every consumer has a
 * provider above it". Nothing had been walked. An app entered only from a server — no client entry
 * at all — was judged as a library, and a library is judged not at all.
 */
const CORE_ROOTS = new Set(["bootstrap", "hydrateRoot", "renderToString", "renderPage", "renderStatic"]);

/**
 * Every static table this file switches on lives HERE, at module scope, and the reason is a crash
 * that has now happened three times: a `const` inside `analyzeProject` is in its temporal dead zone
 * when one of the hoisted `read*` functions reaches it during a pass, and the run dies with
 * `Cannot access 'X' before initialization`. A table is not per-run state; it has no business in
 * the closure. The same goes for a helper — write it as a `function`, which hoists.
 */

/**
 * A test, as the PROJECT sees it — the path is relative to the directory holding the tsconfig.
 *
 * Relative and not absolute, because a project can live inside another project's test tree: this
 * package's own fixtures sit under `src/__tests__/fixtures/`, and each is analysed through its own
 * tsconfig, where nothing is a test.
 *
 * A graph describes what a project SHIPS. A test's `bootstrap` is not the app's root — measured,
 * `@ramonda/form` came out as an app because its tests mount one — and a class written to be
 * checked is not a component the package publishes: with tests in, core's fragment carried
 * `LazyThing` from a fixture directory, and query counted 109 components against a real 12.
 */
const isTest = (relativePath: string): boolean =>
  /(^|\/)(__tests__|tests?)\//.test(relativePath) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(relativePath);

/**
 * How long a path the walk will follow before it stops.
 *
 * The cycle guard keys on a node and its bindings, so a component that mounts itself with a
 * different binding each turn is not a cycle by that key. This is what makes it terminate anyway.
 */
const PATH_LIMIT = 200;

/** How many renames a tag is followed through — `const A = B; const B = Reader`. */
const ALIAS_HOPS = 4;

/** How deep a slot may sit inside a prop, on both sides. Six is far past anything measured. */
const SLOT_DEPTH = 6;

/** The type that says "a component goes here". */
const SLOT_MARKERS = new Set(["ComponentClassKind", "ComponentKind"]);

/**
 * Core's own node types, which a slot walk must not descend into.
 *
 * Every one of them carries a `name: ComponentClassKind` somewhere inside, because that is what a
 * rendered vnode holds — so a walk that merely hunted for the marker reported `children` as a slot.
 * A prop typed `RamondaNode` is a node the caller already WROTE; a slot is one the caller fills.
 */
const NOT_A_SLOT = new Set([
  "RamondaNode",
  "VNode",
  "VNodeComponent",
  "ComponentChild",
  "RamondaAtom",
  "Element",
  "EnhancedElement",
  "ListNode",
]);

export function analyzeProject(tsconfigPath: string): AnalyzeResult {
  const { program, notes } = createProgram(tsconfigPath);
  const checker = program.getTypeChecker();

  /** Symbol id → the context it belongs to, and which half of the pair it is. */
  const providerSymbols = new Map<ts.Symbol, ContextFact>();
  const consumerSymbols = new Map<ts.Symbol, ContextFact>();
  const contexts = new Map<string, ContextFact>();

  /**
   * Symbol of a `createRoutes(...)` binding → the tag names in its table, as NODES.
   *
   * The nodes rather than their text, because a view is resolved to a component by symbol and the
   * table is read in pass 1, before every class is known.
   */
  const routeTables = new Map<ts.Symbol, ts.Node[]>();
  /** Which of them some `<RouteOutlet routes={…}>` in this run actually named, and from where. */
  const mountedTables = new Map<ts.Symbol, ComponentNode[]>();

  /** Every component and hook class, by the symbol of its declaration — see `ComponentNode.id`. */
  const components = new Map<ts.Symbol, ComponentNode>();
  /** `const { Link } = createRouter(routes)` sites, resolved once the classes are all in. */
  const kitDestructures: ts.VariableDeclaration[] = [];
  /** What every rule found, one list per rule id. See `Findings`. */
  const findings = emptyFindings();
  const unresolved: UnresolvedIssue[] = [];
  const secondProviders: SecondProviderIssue[] = [];
  const classesAsChildren: ClassAsChildIssue[] = [];
  const annotated: AnnotatedSite[] = [];
  const roots = new Set<ComponentNode>();
  /** Package root → what its fragment contributed, or `null` for one that has none. */
  const splicedPackages = new Map<string, SplicedPackage | null>();
  /** Components and hooks a fragment brought in, which have no declaration to walk. */
  const splicedNodes: ComponentNode[] = [];
  /**
   * Functions that return JSX, written outside any component class.
   *
   * `function Row(item) { return <li><Cell /></li> }` mounts `Cell` wherever it is called, and
   * nothing attributed those tags to anything before: JSX outside a component class was read only
   * inside a route table or a `bootstrap` argument, and everything else was invisible rather than
   * a hole. Kept out of `components`, because a helper is not one and the printed count says so.
   */
  const helpers = new Map<ts.Symbol, ComponentNode>();
  /** The body to walk for each helper, kept so pass 2.5 does not look it up again. */
  const helperBodies = new Map<ComponentNode, ts.Node>();
  /** One node per `<RouteOutlet routes={…}>` site, so two outlets do not merge their views. */
  const outletSites = new Map<string, ComponentNode>();
  const outletsPerFile = new Map<string, number>();
  /** One per `bootstrap`/`hydrateRoot` call, which is where a tree starts. */
  const rootNodes: GraphNode[] = [];
  /** Where each root's tree starts, for the walk. */
  const rootMounts: { id: string; target: ComponentNode }[] = [];
  const rootsPerFile = new Map<string, number>();
  const fileLines = new Map<string, string[]>();
  /** Every edge as it is found, including the ones that resolve to nothing. */
  const edges: GraphEdge[] = [];

  const projectRoot = dirname(tsconfigPath);

  /**
   * `@ramonda/core/src/base/AsyncLoad.ts` — the OWNING package and the path inside it.
   *
   * Not a path relative to the project, which for a monorepo app compiling its dependencies from
   * source reads `../../packages/core/…`: the same class would be written differently by every app
   * that mounts it, and a fragment emitted by the package itself could never line up with it. The
   * owning package is the one thing about a file that does not depend on who is looking.
   */
  const packageAt = new Map<string, { name: string; root: string } | undefined>();
  const owner = (from: string): { name: string; root: string } | undefined => {
    let dir = from;
    const climbed: string[] = [];
    for (;;) {
      if (packageAt.has(dir)) {
        const found = packageAt.get(dir);
        for (const step of climbed) packageAt.set(step, found);
        return found;
      }
      const up = dirname(dir);
      // The package ROOT is cached, not just its name: caching the name against every directory
      // climbed through and then measuring from THAT directory produced
      // `@ramonda/docs/DataTable.test.tsx` for a file three levels down.
      const found = ts.sys.fileExists(`${dir}/package.json`) ? { name: packageOf(dir).name, root: dir } : undefined;
      if (found || up === dir) {
        packageAt.set(dir, found);
        for (const step of climbed) packageAt.set(step, found);
        return found;
      }
      climbed.push(dir);
      dir = up;
    }
  };
  const pathOf = (file: string): string => {
    const found = owner(dirname(file));
    // No package.json anywhere above: fall back to the project, which is what a fixture has.
    const base = found?.root ?? projectRoot;
    const inside = relative(base, file).split(sep).join("/");
    return found ? `${found.name}/${inside}` : inside;
  };
  const whereOf = (node: ts.Node): Where => {
    const pos = positionOf(node);
    return `${pathOf(pos.file)}:${pos.line}:${pos.column}`;
  };
  /** `src/pages/settings.tsx#Page`, with a `$n` suffix when one file declares the name twice. */
  const takenIds = new Map<string, number>();
  const idFor = (file: string, name: string): string => {
    const base = `${pathOf(file)}#${name}`;
    const seen = takenIds.get(base) ?? 0;
    takenIds.set(base, seen + 1);
    return seen === 0 ? base : `${base}$${seen + 1}`;
  };
  const edge = (
    from: string,
    to: string,
    kind: GraphEdge["kind"],
    via: GraphEdge["via"],
    site: ts.Node,
    binds?: Map<string, ComponentNode[]>,
  ): void => {
    const flat =
      binds && binds.size > 0
        ? [...binds].flatMap(([slot, targets]) => targets.map((t) => ({ slot, to: t.id })))
        : undefined;
    edges.push({
      from,
      to,
      kind,
      via,
      at: whereOf(site),
      ...(flat ? { binds: flat } : {}),
      ...(alwaysRuns(site) ? { always: true } : {}),
    });
  };

  /** Records a mount both ways: as an edge for the format, and as a SITE for the walk. */
  const mount = (
    owner: ComponentNode,
    target: ComponentNode,
    via: GraphEdge["via"],
    site: ts.Node,
    binds: Map<string, ComponentNode[]> = new Map(),
    kind: GraphEdge["kind"] = "renders",
  ): void => {
    owner.mounts.push({ target, binds, always: alwaysRuns(site) });
    edge(owner.id, target.id, kind, via, site, binds);
  };
  /**
   * A directive written on a site that needs none is unnecessary — and reading it is not.
   *
   * A hole that stops being reported must not take its written reason down with it: the reason
   * vanishing from the list the run prints on every pass is exactly the drift that list exists to
   * prevent, and an EMPTY directive would be accepted here while being refused everywhere else.
   * Both exemptions call this — the prop that only a caller can fill, and the parameter that is
   * the same promise through a different door.
   */
  const readDirective = (site: ts.Node, what: string): void => {
    const written = directiveAt(site);
    if (written === "") {
      unresolved.push({
        what,
        why: "a `ramonda-check-ignore` with no reason after it is a silence, not a record",
        fix: `// ramonda-check-ignore why this cannot be resolved`,
        ...positionOf(site),
      });
    } else if (written !== undefined) {
      annotated.push({ what, reason: written, ...positionOf(site) });
    }
  };

  const unresolvedEdge = (
    from: string,
    via: GraphEdge["via"],
    site: ts.Node,
    why: string,
    /** What the site NAMED, when there is a name to read — see `slotFromParameter`. */
    named?: ts.Node,
  ): void => {
    // A value handed in by the caller is a slot, whether it arrived as a prop or as a parameter.
    const fromParameter = slotFromParameter(named);
    if (fromParameter !== undefined) {
      edges.push({ from, kind: "unresolved", via: "parameter", at: whereOf(site), slot: fromParameter, why });
      readDirective(site, "parameter");
      return;
    }
    edges.push({ from, kind: "unresolved", via, at: whereOf(site), why });

    const pos = positionOf(site);
    const written = directiveAt(site);
    if (written !== undefined) {
      if (written === "") {
        unresolved.push({
          what: via,
          why: "a `ramonda-check-ignore` with no reason after it is a silence, not a record",
          fix: `// ramonda-check-ignore why this cannot be resolved`,
          ...pos,
        });
      } else {
        annotated.push({ what: via, reason: written, ...pos });
      }
      return;
    }
    unresolved.push({ what: via, why, fix: fixFor(via), ...pos });
  };

  /**
   * The directive on this site's own line or the line above it, and the reason after it.
   *
   * Read from the LINE rather than from the comment attached to a node: a JSX attribute's comments
   * do not attach where a reader would expect, and the rule people can hold in their head is "the
   * line, or the line above it".
   */
  function directiveAt(site: ts.Node): string | undefined {
    const file = site.getSourceFile();
    const lines = fileLines.get(file.fileName) ?? file.text.split("\n");
    fileLines.set(file.fileName, lines);
    const { line } = file.getLineAndCharacterOfPosition(site.getStart());
    for (const candidate of [lines[line], lines[line - 1]]) {
      const found = candidate === undefined ? null : /ramonda-check-ignore\b:?(.*)$/.exec(candidate);
      if (!found) continue;
      // The comment's own closing delimiter is not part of the reason: JSX writes one, and a block
      // comment writes one. Left in, an EMPTY directive read as a reason.
      //
      // A markup terminator was stripped here too, and CodeQL was right to flag it — HTML accepts
      // more than one spelling of it, so the pair was half-handled. It is gone rather than
      // completed: this reads the files of a TypeScript program, which are never markup, so the
      // branch was for a case that cannot arrive.
      return found[1].replace(/\*\/\s*\}?\s*$/, "").trim();
    }
    return undefined;
  }

  const sources = program
    .getSourceFiles()
    .filter(
      (f) =>
        !f.isDeclarationFile &&
        !f.fileName.includes("node_modules") &&
        !isTest(relative(projectRoot, f.fileName).split(sep).join("/")),
    );

  /**
   * Which Ramonda packages this project imports at all, read once from the source.
   *
   * A rule declaring `needs` is dropped from the run unless its package is in here. That was one
   * boolean — `usesRouter` — written for the one rule that had the question, and the reason it is
   * a set now is that the question is not special: a rule about a form, a query or a lens will ask
   * the same thing, and each would otherwise arrive with its own scan and its own `if`.
   *
   * **An IMPORT and not a mounted component,** because a kit hides the mount: an app imports
   * `@ramonda/router` in one file, builds `Navigator` and `Link` there, and every component sees
   * those instead. A subpath counts as the package — `@ramonda/router/server` means the router is
   * present just as plainly.
   */
  const imported = new Set<string>();
  for (const file of sources) {
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith("@ramonda/")) continue;
      const [scope, name] = specifier.split("/");
      imported.add(`${scope}/${name}`);
    }
  }

  /**
   * The per-class rules this project runs.
   *
   * Filtered once rather than per class: `needs` is a fact about the project, and asking it 68
   * times for one component would be the same answer 68 times. `exempt` is per class and is applied
   * by `applyClass` — see the note on it.
   */
  const rules = activate(CLASS_RULES, imported);

  /**
   * The per-FILE rules, and one pass over the sources to run them.
   *
   * Their own loop rather than a line inside one of the passes below: those walk looking for
   * classes and roots, and a question about what a module imports has no class to hang off. One
   * pass over the files is also the cheapest shape — a rule sees each file once, however many
   * components are in it.
   */
  /**
   * The per-ELEMENT rules, run from the same pass as the per-file ones.
   *
   * Every JSX element in the project, host tags and components alike — the rules themselves decide
   * which tag they are about, and a component tag answers `undefined` to that question. Walking
   * from the file rather than from a component is deliberate: markup written in a plain helper
   * function is markup all the same, and an accessibility fault does not become acceptable for
   * having been written outside a class.
   */
  const elementRules = activate(ELEMENT_RULES, imported);

  const readElements = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) applyElement(elementRules, node, findings);
    ts.forEachChild(node, readElements);
  };

  const moduleRules = activate(MODULE_RULES, imported);

  /**
   * The per-RENDER rules, from the same pass again.
   *
   * A render is one top-level JSX tree in the source, so the subjects are found by walking the file
   * and stopping at the first markup on each path — everything below a root belongs to that root.
   * From the FILE rather than from a class, for the same reason the element rules do: markup
   * written in a plain helper function is markup all the same.
   */
  const treeRules = activate(TREE_RULES, imported);

  for (const file of sources) {
    if (elementRules.length > 0) readElements(file);
    if (treeRules.length > 0) for (const root of rootsIn(file)) applyTree(treeRules, root, findings);

    applyModule(
      moduleRules,
      file,
      (ruleId) => ({
        unlessAnnotated: (site, make) => {
          const written = directiveAt(site);
          if (written === undefined) return make();
          // Recorded rather than dropped: a site that stops being reported must not take its
          // written reason down with it, and an EMPTY directive is refused here exactly as it is
          // everywhere else in this package.
          readDirective(site, ruleId);
          return undefined;
        },
      }),
      findings,
    );
  }

  // ── Pass 1: the context pairs, the route tables, and every component class by symbol ────────
  for (const file of sources) {
    ts.forEachChild(file, function visit(node) {
      collectContextPair(node);
      if (isKitDestructure(node)) kitDestructures.push(node);
      collectRouteTable(node);
      collectClass(node);
      ts.forEachChild(node, visit);
    });
  }

  // After every class is known: a kit's key names a component, and `componentAt` has to be able to
  // find it. Resolving during the walk would answer only for the classes collected so far.
  for (const node of kitDestructures) resolveKitDestructure(node);

  // ── Pass 1.5: functions that return JSX, which are edges nothing owned before ────────────────
  for (const file of sources) {
    let insideComponent = 0;
    ts.forEachChild(file, function visit(node) {
      const entering = ts.isClassDeclaration(node) && componentKind(node, checker) !== undefined;
      if (entering) insideComponent += 1;
      collectHelper(node, insideComponent > 0);
      ts.forEachChild(node, visit);
      if (entering) insideComponent -= 1;
    });
  }

  // ── Pass 2: what each component provides, consumes and renders ──────────────────────────────
  for (const file of sources) {
    ts.forEachChild(file, function visit(node) {
      if (ts.isClassDeclaration(node) && node.name) {
        const symbol = checker.getSymbolAtLocation(node.name);
        const self = symbol && components.get(symbol);
        if (self) {
          readClassBody(node, self);
          applyClass(rules, node, { self, resolve, resolveLocal }, findings);
        }
      }
      collectRoot(node);
      ts.forEachChild(node, visit);
    });
  }

  // ── Pass 2.5: what each helper renders, and who calls it ────────────────────────────────────
  for (const helper of helpers.values()) {
    const declaration = helperBodies.get(helper);
    if (!declaration) continue;
    /**
     * The body ITSELF, not its children.
     *
     * `const header = () => <Legend />` stores the element as the body, and iterating its children
     * reaches the tag name and the attributes but never the element — so the helper came out with
     * no edges at all, and no hole either. A block body falls through to `forEachChild` inside
     * `walkJsx` and is unaffected.
     */
    walkJsx(declaration, helper, helper);
    (function visit(node: ts.Node) {
      collectCall(node, helper);
      // The factory too: a helper may mount everything it mounts without writing one tag.
      collectFactory(node, helper);
      if (node !== declaration && helperAt(node) !== undefined) return;
      ts.forEachChild(node, visit);
    })(declaration);
  }

  /**
   * The three non-composition checks were tried over test files too, and it was WRONG.
   *
   * The reviewer's point stands on its face — a function literal in a class field is a fault
   * wherever it is written, and `main` reported them in tests. Measured, though: restoring it fails
   * `@ramonda/core`'s own build on `class Bad { fn = () => … }` and `Widget.handler`, both written
   * to be bad because they are what their test is ABOUT. A gate that fails on a fixture written to
   * fail is one people switch off, which is the argument this package's README opens with.
   *
   * So the exclusion stays for all four checks, and the cost is written down rather than hidden:
   * a real fault written in a test file is not reported.
   */

  resolveHookContexts();
  const reached = new Set<ComponentNode>();
  const issues = walk(reached);
  const unreachable = deadOnes(reached);
  const unreachableRoutes = strandedRoutes(reached);
  const renderCycles = endlessRings();

  return {
    issues,
    findings,
    unresolved,
    annotated,
    unreachable,
    unreachableRoutes,
    secondProviders,
    renderCycles,
    classesAsChildren,
    counts: {
      components: components.size,
      contexts: contexts.size,
      roots: roots.size,
    },
    graph: buildGraph(),
    notes,
  };

  // ── collection ──────────────────────────────────────────────────────────────────────────────

  /**
   * A cheap shape test: `const { … } = someCall()`. Recorded during the walk and answered later.
   *
   * It says nothing about WHICH factory, on purpose — that question needs every class in the
   * program to have been collected first, and this runs while they are still being collected.
   * `resolveKitDestructure` is where a candidate becomes a kit or stays nothing.
   */
  function isKitDestructure(node: ts.Node): node is ts.VariableDeclaration {
    return (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      ts.isObjectBindingPattern(node.name)
    );
  }

  /**
   * The object literal a function hands back, if it plainly hands one back.
   *
   * Two shapes and no more: `return { … }` in a body, and a concise arrow `() => ({ … })`. A factory
   * that builds its result any other way is one this cannot read, and it says so by resolving
   * nothing rather than by guessing.
   */
  function returnedObject(declaration: ts.Declaration | undefined): ts.ObjectLiteralExpression | undefined {
    const fn =
      declaration && (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration))
        ? declaration
        : declaration &&
            ts.isVariableDeclaration(declaration) &&
            declaration.initializer &&
            (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
          ? declaration.initializer
          : undefined;
    if (!fn) return undefined;

    const body = fn.body;
    if (!body) return undefined;
    if (!ts.isBlock(body))
      return ts.isParenthesizedExpression(body) && ts.isObjectLiteralExpression(body.expression)
        ? body.expression
        : undefined;

    let found: ts.ObjectLiteralExpression | undefined;
    for (const statement of body.statements) {
      if (ts.isReturnStatement(statement) && statement.expression) {
        const expression = unwrapAs(statement.expression);
        if (ts.isObjectLiteralExpression(expression)) found = expression;
      }
    }
    return found;
  }

  /** What a key of that object NAMES, with the `as` casts peeled off. */
  function memberNamed(literal: ts.ObjectLiteralExpression, key: string): ComponentNode | undefined {
    for (const property of literal.properties) {
      if (!property.name || !ts.isIdentifier(property.name) || property.name.text !== key) continue;
      if (ts.isShorthandPropertyAssignment(property)) return componentAt(property.name);
      if (ts.isPropertyAssignment(property)) return componentAt(unwrapAs(property.initializer));
    }
    return undefined;
  }

  /**
   * `const { Router, RouteOutlet, Link } = createRouter(routes)` — a kit of components handed back by
   * a factory, destructured once and used as tags everywhere after.
   *
   * This is the shape `npm create ramonda` scaffolds and the routing documentation teaches, and every
   * tag written from it used to be a hole. A hole is an ERROR here, so a scaffolded routed project
   * could not build at all — and nothing BELOW an unresolved tag is judged, so most of the app went
   * unexamined with it.
   *
   * **Nothing is guessed**, and the two branches are the two ways a factory can be in front of you.
   *
   * INSTALLED — the factory is declared in a `.d.ts` and its package ships a fragment. `componentAt`
   * already answers a direct import that way, by taking the symbol's name to the fragment; the same
   * two facts sit one step apart here, the callee being the package's and the key being its name.
   * It has to read the fragment rather than the factory's return type, because the type is where the
   * answer stops being there: `@ramonda/router` publishes `Router: typeof Router` but
   * `Link: ComponentClassKind<TypedLinkProps<…>>`, the latter having gone through `as unknown as`.
   *
   * FROM SOURCE — the factory is in this program, so there is no fragment and no need for one: the
   * `return { … }` is right there, and a key names a class exactly as a tag does. This is not the
   * rarer half. It is how this repository builds its own apps, which is why the first version passed
   * every fixture and still failed the docs site.
   */
  function resolveKitDestructure(node: ts.VariableDeclaration): void {
    const initializer = node.initializer as ts.CallExpression;
    const name = node.name as ts.ObjectBindingPattern;

    const callee = initializer.expression;
    const factory = ts.isIdentifier(callee) || ts.isPropertyAccessExpression(callee) ? resolve(callee) : undefined;
    if (!factory) return;

    const spliced = splicedFor(factory);
    const literal = spliced ? undefined : returnedObject(factory.declarations?.[0]);
    if (!spliced && !literal) return;

    for (const element of name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      // `const { Link: Anchor } = …` — the KEY is what the package named, the local name is the
      // caller's business, and it is the key that has to match.
      const key = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName : element.name;

      // Exported or not. A kit's members are routinely NOT exported — that is the point of handing
      // them back through a factory rather than the entry — so the exported-only rule the first
      // version had was wrong for the one shape this exists to resolve. What keeps it honest is that
      // the FACTORY is the package's own, and the key is the package's own name for what it handed over.
      const member = spliced
        ? (spliced.components.get(key.text) ?? spliced.internals.get(key.text))
        : memberNamed(literal as ts.ObjectLiteralExpression, key.text);
      if (!member) continue;

      const local = checker.getSymbolAtLocation(element.name);
      if (local) components.set(local, member);
    }
  }

  /** `const [Theme, ThemeConsumer] = createContext({...}, { label: "Theme" })` */
  function collectContextPair(node: ts.Node): void {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    if (!ts.isCallExpression(node.initializer)) return;
    if (calleeName(node.initializer) !== "createContext") return;
    if (!ts.isArrayBindingPattern(node.name)) return;

    const pos = positionOf(node);
    const label = labelOf(node.initializer) ?? bindingName(node.name, 1) ?? bindingName(node.name, 0) ?? "context";
    const providerName = bindingName(node.name, 0);
    /**
     * ONE identity, and it is the graph's.
     *
     * It used to be `<absolute file>:<line>` internally and a graph id in the artifact. A spliced
     * fragment can only speak the graph id, so a package's `consumes` naming a context declared
     * outside it could never meet the local `provides` that satisfies it — the app failed the
     * build against correct code. Named after the PROVIDER binding, because that is what an app
     * mounts and what a message tells you to mount.
     */
    const id = idFor(pos.file, providerName ?? label);
    const fact: ContextFact = {
      id,
      graphId: id,
      at: whereOf(node),
      provider: providerName,
      consumer: bindingName(node.name, 1),
      label,
      optional: flagOf(node.initializer, "optional"),
      single: flagOf(node.initializer, "single"),
    };
    contexts.set(id, fact);

    const [providerEl, consumerEl] = node.name.elements;
    const provider = bindingSymbol(providerEl);
    const consumer = bindingSymbol(consumerEl);
    if (provider) providerSymbols.set(provider, fact);
    if (consumer) consumerSymbols.set(consumer, fact);
  }

  /** `const routes = createRoutes({ "/": <Home/> })` — the views are rendered by whichever
   * component hands this table to a `<RouteOutlet>`. */
  function collectRouteTable(node: ts.Node): void {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    if (!ts.isCallExpression(node.initializer) || calleeName(node.initializer) !== "createRoutes") return;
    const symbol = node.name && ts.isIdentifier(node.name) ? checker.getSymbolAtLocation(node.name) : undefined;
    if (!symbol) return;
    routeTables.set(symbol, viewsOf(node.initializer));
  }

  /**
   * Every name a route table gives a view, however the table was built.
   *
   * Reading only the JSX written INSIDE `createRoutes(...)` covered a literal table and nothing
   * else — and this repository's documentation site builds its table in a loop, `table[page.path] =
   * __h(DocPage, { meta: page })`, over a hundred paths. Measured: its whole routing was invisible,
   * the walk reached 10 of 153 nodes, and the run still said every consumer had a provider above
   * it. It had judged almost nothing.
   *
   * So an identifier is followed to its declaration and to every WRITE into that binding, and a
   * view is read whether it is written as a tag or handed to the factory directly.
   */
  function viewsOf(call: ts.CallExpression): ts.Node[] {
    const found: ts.Node[] = [];
    const scan = (from: ts.Node): void => {
      ts.forEachChild(from, function walk(n) {
        const opening = openingOf(n);
        if (opening && jsxTagName(n)) found.push(opening.tagName);
        // `__h(DocPage, …)` — the same edge, written through the factory the JSX compiles to.
        if (ts.isCallExpression(n) && /^_*h$/.test(n.expression.getText())) {
          const first = n.arguments[0];
          if (first && ts.isIdentifier(first) && /^[A-Z]/.test(first.text)) found.push(first);
        }
        ts.forEachChild(n, walk);
      });
    };

    const table = call.arguments[0];
    if (!table) return found;
    if (!ts.isIdentifier(table)) {
      scan(call);
      return found;
    }

    const declaration = resolve(table)?.declarations?.[0];
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) scan(declaration);
    const file = declaration?.getSourceFile();
    if (file) {
      ts.forEachChild(file, function walk(n) {
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const target = n.left;
          if (ts.isElementAccessExpression(target) && target.expression.getText() === table.text) scan(n);
        }
        ts.forEachChild(n, walk);
      });
    }
    return found;
  }

  function collectClass(node: ts.Node): void {
    if (!ts.isClassDeclaration(node) || !node.name) return;
    const kind = componentKind(node, checker);
    if (!kind) {
      /**
       * A heritage clause that is a CALL — `class Panel extends withTheme(Component)`.
       *
       * Answering it needs a TYPE, and this resolver is on symbols, so the class is not a
       * component here. Dropping it in silence made the omission invisible: it rendered nothing,
       * consumed nothing and was reachable from nothing, so no rule could notice. Said out loud
       * instead, which is what the design asks for.
       */
      const base = baseExpression(node);
      if (base && ts.isCallExpression(base)) {
        const at = positionOf(node);
        notes.push(
          `${pathOf(at.file)}:${at.line}:${at.column} — \`${node.name.text}\` extends a call, which needs a type to follow, so it is not in the graph`,
        );
      }
      return;
    }
    const symbol = checker.getSymbolAtLocation(node.name);
    if (!symbol || components.has(symbol)) return;
    const pos = positionOf(node);
    components.set(symbol, {
      id: idFor(pos.file, node.name.text),
      kind,
      name: node.name.text,
      file: pos.file,
      line: pos.line,
      column: pos.column,
      provides: new Set(),
      consumes: new Map(),
      mounts: [],
      slotHoles: [],
      slots: slotsOf(node),
      exported: (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0,
      uses: new Set(),
      opaque: false,
      usesChildren: node.getText().includes("children"),
    });
  }

  /** `bootstrap(<App />, el)` / `renderPage(<App />)` — where a tree starts. */
  function collectRoot(node: ts.Node): void {
    if (!ts.isCallExpression(node)) return;
    /**
     * A BARE identifier, so a method of the same name is not a root.
     *
     * `calleeName` reads the property off a property access, which is right for `this.use(X)` and
     * wrong here: two apps in this repository have a component method called `renderPage`
     * (`apps/docs/src/App.tsx:41`, `apps/playground-ssr/src/ProductsPage.tsx:267`), and each
     * `this.renderPage(page)` would otherwise be a root whose first argument is a row of data.
     * An entry is imported and called by its own name; nothing here is written through an object.
     */
    if (!ts.isIdentifier(node.expression)) return;
    const name = node.expression.text;
    if (!CORE_ROOTS.has(name)) return;
    const pos = positionOf(node);
    // Numbered within its file rather than by line, for the same reason a component's id carries no
    // line: moving a call down a file would otherwise rename the node and a graph diff would report
    // a root that did not change.
    const file = pathOf(pos.file);
    const ordinal = (rootsPerFile.get(file) ?? 0) + 1;
    rootsPerFile.set(file, ordinal);
    const id = `${file}#${name}${ordinal > 1 ? `$${ordinal}` : ""}`;
    rootNodes.push({ id, kind: "root", at: whereOf(node) });

    const opening = node.arguments[0] ? openingOf(node.arguments[0]) : undefined;
    const target = opening && componentAt(opening.tagName);
    if (target) {
      roots.add(target);
      // A root has no props, so it hands nothing to a slot.
      rootMounts.push({ id, target });
      edge(id, target.id, "renders", "bootstrap", node);
    } else {
      /**
       * The reason is read from what was WRITTEN, which is the argument itself when it is not JSX.
       *
       * Reading `opening?.tagName` alone gave `undefined` for every non-JSX argument and the
       * generic "…'s first argument is not a component element" — so a slot edge said it was
       * waiting on `vnode` while its own reason said there was nothing to wait on. Measured on
       * core's `renderPage`, which is exactly that shape.
       */
      const written = node.arguments[0] ? unwrapAs(node.arguments[0]) : undefined;
      unresolvedEdge(
        id,
        "bootstrap",
        node,
        whyUnresolved(opening?.tagName ?? written, `${name}'s first argument`),
        written,
      );
    }
  }

  /**
   * `__h(Thing, …)` — the factory JSX compiles to, called by hand.
   *
   * A tag is not the only way to mount a component, and this repository's documentation site uses
   * the other one throughout: `__h(component, null)` with the component taken from a registry, and
   * `__h(ExamplesIndex, {})` with it named outright. Neither is a JSX element, so the walk saw
   * nothing — measured, it reached 10 of 153 nodes there and still said every consumer had a
   * provider above it.
   *
   * A string tag is an intrinsic element and owns nothing. Anything else names a component, and if
   * it cannot be followed it is a hole like any other.
   */
  function collectFactory(node: ts.Node, self: ComponentNode): void {
    if (!ts.isCallExpression(node) || !/^_*h$/.test(node.expression.getText())) return;
    const named = node.arguments[0];
    if (!named || ts.isStringLiteralLike(named)) return;
    // `__h(tag, …)` where every value `tag` can hold is a string is an intrinsic element, and owns
    // nothing. Read from the syntax, one hop: `const tag = typeof pre === "string" ? "pre" : pre.t`
    // is the shape the documentation site writes, and reporting it would be reporting a `<pre>`.
    if (namesAnElement(unwrapAs(named))) return;

    const direct = componentAt(unwrapAs(named));
    if (direct) {
      mount(self, direct, "factory", node);
      return;
    }
    // One hop through a local const, which is how a registry lookup is written in practice:
    // `const component = demos[name]; __h(component, null)`.
    const behind = initializerBehind(unwrapAs(named));
    const union = registryComponents(unwrapAs(named)) ?? (behind ? registryComponents(unwrapAs(behind)) : undefined);
    if (union === undefined && behind) {
      const hopped = componentAt(unwrapAs(behind));
      if (hopped) {
        mount(self, hopped, "factory", node);
        return;
      }
    }
    if (union === undefined) {
      unresolvedEdge(
        self.id,
        "factory",
        node,
        whyUnresolved(unwrapAs(named), "the factory's first argument"),
        unwrapAs(named),
      );
      return;
    }
    for (const target of union) mount(self, target, "factory", node);
  }

  /**
   * Whether every value this expression can hold is a string — an intrinsic element.
   *
   * One hop to a local const, and both arms of a ternary, which is how a tag chosen between two
   * elements is written. Anything else is unknown, and unknown is a hole rather than a guess.
   */
  function namesAnElement(expression: ts.Expression): boolean {
    if (ts.isStringLiteralLike(expression)) return true;
    if (ts.isConditionalExpression(expression)) {
      return namesAnElement(unwrapAs(expression.whenTrue)) && namesAnElement(unwrapAs(expression.whenFalse));
    }
    if (ts.isIdentifier(expression)) {
      const behind = initializerBehind(expression);
      return behind !== undefined && behind !== expression && namesAnElement(unwrapAs(behind));
    }
    return false;
  }

  /** `value as never` and `(value)` are the same value; the cast is for the compiler, not for this. */
  function unwrapAs(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
    }
    return current;
  }

  /**
   * `REGISTRY[key]` — every component a literal map's values name.
   *
   * The key is decided at run time and the map is not: what MAY be mounted is the union of its
   * values, which is the same `may reach` the whole walk is on. `undefined` means this is not that
   * shape, so the caller records a hole.
   */
  function registryComponents(expression: ts.Expression): ComponentNode[] | undefined {
    if (!ts.isElementAccessExpression(expression)) return undefined;
    const declaration = resolve(unwrapAs(expression.expression))?.declarations?.[0];
    const registry =
      declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration))
        ? declaration.initializer
        : undefined;
    if (!registry || !ts.isObjectLiteralExpression(registry)) return undefined;

    const found: ComponentNode[] = [];
    for (const property of registry.properties) {
      if (ts.isPropertyAssignment(property)) {
        const target = componentAt(unwrapAs(property.initializer));
        if (target) found.push(target);
        continue;
      }
      /**
       * `{ Counter, ComputeDemo }` — a shorthand, and the symbol at that name is the PROPERTY, not
       * the value. Asking the checker for the property's symbol finds no class and the whole
       * registry reads as empty, which is how the documentation site's forty demos stayed
       * unreachable while the map sat in front of it.
       */
      if (ts.isShorthandPropertyAssignment(property)) {
        let symbol = checker.getShorthandAssignmentValueSymbol(property);
        // …and that symbol is the local binding, which for `{ Counter }` beside
        // `import { Counter } from "./Counter"` is the IMPORT. One more hop reaches the class.
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        const target = symbol ? (components.get(symbol) ?? splicedFor(symbol)?.components.get(symbol.name)) : undefined;
        if (target) found.push(target);
      }
    }
    return found.length > 0 ? found : undefined;
  }

  /**
   * A call to a function that returns JSX: whatever it writes mounts wherever the call sits.
   *
   * Read in a HELPER's body as well as a component's. It was a component's only, so a helper
   * calling a helper produced no edge at all — and the double attribution below was what
   * accidentally covered for it.
   */
  function collectCall(node: ts.Node, self: ComponentNode): void {
    if (!ts.isCallExpression(node) || readElsewhere(node)) return;
    const callee =
      ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression) ? node.expression : undefined;
    const symbol = callee ? resolve(callee) : undefined;
    const called = symbol ? helpers.get(symbol) : undefined;
    if (called && called !== self) mount(self, called, "call", node, new Map(), "calls");

    /**
     * A helper handed OVER rather than called — `tree.map(toVNode)`.
     *
     * Whoever it is given to will run it, so what it mounts is reachable from here. Measured: the
     * documentation site renders its whole content tree that way, and reading only `toVNode(…)`
     * left the helper in the graph with nothing reaching it.
     */
    for (const argument of node.arguments) {
      const handed =
        ts.isIdentifier(argument) || ts.isPropertyAccessExpression(argument) ? resolve(argument) : undefined;
      const target = handed ? helpers.get(handed) : undefined;
      if (target && target !== self) mount(self, target, "call", argument, new Map(), "calls");
    }
  }

  /** The helper this node declares, if it declares one — the three shapes `collectHelper` reads. */
  function helperAt(node: ts.Node): ComponentNode | undefined {
    let named: ts.Identifier | undefined;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      named = node.name && ts.isIdentifier(node.name) ? node.name : undefined;
    } else if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const value = node.initializer;
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) named = node.name;
    }
    if (!named) return undefined;
    const symbol = checker.getSymbolAtLocation(named);
    return symbol ? helpers.get(symbol) : undefined;
  }

  /**
   * A function that returns JSX, written outside any component class.
   *
   * Three shapes, which are the three people write: a declared function, a const holding an arrow
   * or a function expression, and a method of a class that is not a component. JSX handed to
   * `createRoutes` or to `bootstrap` is not one of these — a route table and a root are read where
   * they are, and reading them twice would give one mount two owners.
   */
  function collectHelper(node: ts.Node, insideComponent: boolean): void {
    if (insideComponent) return;

    let named: ts.Identifier | undefined;
    let source: ts.Node | undefined;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      source = node.body;
      named = node.name && ts.isIdentifier(node.name) ? node.name : undefined;
    } else if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const value = node.initializer;
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
        source = value.body;
        named = node.name;
      }
    }
    if (!source || !named) return;
    if (!rendersSomething(source)) return;

    const name = named.text;
    const symbol = checker.getSymbolAtLocation(named);
    if (!symbol || helpers.has(symbol)) return;
    // `export function renderOne(…)` and `export const appNode = …` — an SSR entry is called by the
    // server, not by this program, so being exported is the only sign it is a way IN.
    const declared = ts.isVariableDeclaration(node) ? node.parent.parent : node;
    const exported = (ts.getCombinedModifierFlags(declared as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
    const pos = positionOf(node);
    const made: ComponentNode = {
      id: idFor(pos.file, name),
      kind: "helper",
      name,
      file: pos.file,
      line: pos.line,
      column: pos.column,
      provides: new Set(),
      consumes: new Map(),
      mounts: [],
      slotHoles: [],
      slots: [],
      exported,
      uses: new Set(),
      opaque: false,
      usesChildren: false,
    };
    helpers.set(symbol, made);
    helperBodies.set(made, source);
  }

  /** Whether a body writes a component tag of its own, ignoring the two that are read elsewhere. */
  function rendersSomething(body: ts.Node): boolean {
    let found = false;
    (function scan(node: ts.Node) {
      if (found || readElsewhere(node)) return;
      if (jsxTagName(node)) {
        found = true;
        return;
      }
      /**
       * …or mounts through the factory, which a function may do without writing a single tag.
       *
       * `toVNode` in the documentation site is exactly that: it walks a content tree and calls
       * `__h` for every node. Looking for tags alone made it no helper at all, so its body was
       * never walked and everything it mounts — the demo registry, the code block, the table —
       * was unreachable while the function sat in plain sight.
       */
      if (ts.isCallExpression(node) && /^_*h$/.test(node.expression.getText())) {
        const named = node.arguments[0];
        if (named && !ts.isStringLiteralLike(named)) {
          found = true;
          return;
        }
      }
      ts.forEachChild(node, scan);
    })(body);
    return found;
  }

  /**
   * Whether this call's JSX is an edge somewhere else already, so reading it here would give one
   * mount two owners.
   *
   * A root argument always is: `collectRoot` reads every `bootstrap` call wherever it sits. A route
   * table only is when it is BOUND — `collectRouteTable` reads `const routes = createRoutes(…)` and
   * nothing else — so a table built inline is read by nobody, and skipping it lost the edge that
   * `main` produced from the component that wrote it.
   */
  function readElsewhere(node: ts.Node): boolean {
    if (!ts.isCallExpression(node)) return false;
    const callee = calleeName(node);
    if (callee !== undefined && CORE_ROOTS.has(callee)) return true;
    if (callee !== "createRoutes") return false;
    const bound = node.parent;
    if (!bound || !ts.isVariableDeclaration(bound) || !ts.isIdentifier(bound.name)) return false;
    const symbol = checker.getSymbolAtLocation(bound.name);
    return symbol !== undefined && routeTables.has(symbol);
  }

  /**
   * One node per `<RouteOutlet routes={…}>` SITE, mounted by the component that writes the tag.
   *
   * The views used to hang off the shared `RouteOutlet` class, so two outlets in one app put every
   * view on one node and made each reachable from the other — the merge avoided for `AsyncLoad`
   * and missed here. A site of its own keeps them apart, and it `uses` the outlet class so the
   * matched params the outlet publishes still reach the views: they have to be below that provider,
   * which is the whole reason the views were attributed to the outlet in the first place.
   */
  function outletSite(node: ts.JsxSelfClosingElement | ts.JsxOpeningElement, self: ComponentNode): ComponentNode {
    const pos = positionOf(node);
    const file = pathOf(pos.file);
    const key = `${file}:${pos.line}:${pos.column}`;
    const already = outletSites.get(key);
    if (already) return already;

    const ordinal = (outletsPerFile.get(file) ?? 0) + 1;
    outletsPerFile.set(file, ordinal);
    const outletClass = componentAt(node.tagName);
    const made: ComponentNode = {
      id: `${file}#RouteOutlet@${ordinal}`,
      kind: "component",
      name: outletClass?.name ?? "RouteOutlet",
      file: pos.file,
      line: pos.line,
      column: pos.column,
      provides: new Set(),
      consumes: new Map(),
      mounts: [],
      slotHoles: [],
      slots: [],
      exported: false,
      uses: outletClass ? new Set([outletClass]) : new Set(),
      opaque: false,
      usesChildren: false,
    };
    outletSites.set(key, made);
    mount(self, made, "route", node);
    return made;
  }

  /**
   * `{Named}` where `<Named />` was meant.
   *
   * A class among children renders nothing and says nothing — measured in core, the page comes up
   * without it and no record is emitted, because a class is a function and the check for an object
   * among children never sees it. Nothing legitimate has this shape: handing a component over is an
   * ATTRIBUTE, and that is a binding rather than a child.
   */
  function namedWhereAnElementWasMeant(child: ts.Node): void {
    if (!ts.isJsxExpression(child) || !child.expression) return;
    const look = (expression: ts.Expression, depth: number): void => {
      if (depth > 2) return;
      const target = componentAt(unwrapAs(expression));
      if (target) {
        classesAsChildren.push({ name: target.name, ...positionOf(expression) });
        return;
      }
      // `{cond && Named}` and `{cond ? Named : null}` are the same mistake behind a branch.
      if (ts.isConditionalExpression(expression)) {
        look(expression.whenTrue, depth + 1);
        look(expression.whenFalse, depth + 1);
        return;
      }
      if (
        ts.isBinaryExpression(expression) &&
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        look(expression.right, depth + 1);
        return;
      }
      if (ts.isArrayLiteralExpression(expression)) for (const element of expression.elements) look(element, depth + 1);
    };
    look(child.expression, 0);
  }

  /**
   * Whether this site runs on every render of the body it is written in.
   *
   * Nothing between it and the class member may be able to skip it: no branch, no `&&`, no loop,
   * and no callback — a function handed to something else is a maybe, whoever calls it. Read as
   * syntax, and it answers NO whenever it is unsure, so a missing flag can never invent a fault.
   */
  function alwaysRuns(site: ts.Node): boolean {
    for (let node: ts.Node | undefined = site.parent; node; node = node.parent) {
      if (
        ts.isConditionalExpression(node) ||
        ts.isIfStatement(node) ||
        ts.isSwitchStatement(node) ||
        ts.isCaseClause(node) ||
        ts.isCatchClause(node) ||
        ts.isForStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isDoStatement(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      ) {
        return false;
      }
      if (ts.isBinaryExpression(node)) {
        const kind = node.operatorToken.kind;
        if (
          kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          kind === ts.SyntaxKind.BarBarToken ||
          kind === ts.SyntaxKind.QuestionQuestionToken
        ) {
          return false;
        }
      }
      if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isPropertyDeclaration(node)) return true;
    }
    return false;
  }

  /** The component a name in value position refers to, resolved through an import alias. */
  function componentAt(node: ts.Node, hops = 0): ComponentNode | undefined {
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = resolve(node);
    if (!symbol) return undefined;
    const direct = components.get(symbol) ?? splicedFor(symbol)?.components.get(symbol.name);
    if (direct) return direct;

    /**
     * `const Alias = Reader` and then `<Alias />`.
     *
     * One hop to what the name was declared with, which is the same hop already made for a loader,
     * for a binding and for a factory's registry — a tag was the one place without it, and it was
     * reported as a hole. Nothing is guessed: the initializer NAMES a class, and a name is all this
     * ever follows.
     */
    // Bounded, because two constants that name each other are a runtime error and ordinary syntax:
    // following one into the other without spending a hop runs the stack out. The same fault the
    // review found in the binding walk, and the `slots` fixture caught it here within the minute.
    if (hops >= ALIAS_HOPS) return undefined;
    const behind = initializerBehind(node);
    if (!behind || behind === node) return undefined;
    if (ts.isIdentifier(behind) || ts.isPropertyAccessExpression(behind)) return componentAt(behind, hops + 1);
    return undefined;
  }

  /**
   * The fragment of the package a symbol was declared in, spliced in on first sight.
   *
   * A package compiled from source contributes its own classes and needs none of this. A package
   * INSTALLED contributes a `.d.ts` and nothing else — `analyze` drops declaration files, which is
   * why a package's composition used to vanish at its boundary. That is the hole a fragment closes.
   */
  function splicedFor(symbol: ts.Symbol): SplicedPackage | undefined {
    const file = symbol.declarations?.[0]?.getSourceFile();
    if (!file) return undefined;
    if (!file.isDeclarationFile && !file.fileName.includes("node_modules")) return undefined;
    const root = packageRootOf(file.fileName);
    return root === undefined ? undefined : splice(root);
  }

  function splice(root: string): SplicedPackage | undefined {
    const already = splicedPackages.get(root);
    if (already !== undefined) return already ?? undefined;

    const name = packageOf(root).name;
    const { fragment, refused } = loadFragment(root, name);
    if (refused) notes.push(refused);
    if (!fragment) {
      splicedPackages.set(root, null);
      return undefined;
    }

    const here: SplicedPackage = { components: new Map(), contexts: new Map(), internals: new Map() };
    const byId = new Map<string, ComponentNode>();
    const ambiguous = new Set<string>();
    /**
     * Kept apart from `ambiguous` because the two are different namespaces: a package may well
     * export a `Panel` and declare another one privately, and neither should make the other
     * unanswerable.
     */
    const ambiguousInternals = new Set<string>();

    for (const node of fragment.graph.nodes) {
      if (node.kind === "component" || node.kind === "hook" || node.kind === "helper") {
        const at = splitWhere(node.at);
        const made: ComponentNode = {
          id: node.id,
          // A helper carries a package's composition as much as a component does: drop it and a
          // consumer reached only through `function row() { return <Cell /> }` inside an installed
          // package is invisible, which is the silence fragments exist to remove.
          kind: node.kind,
          name: node.name ?? node.id,
          // The path INSIDE the package, which is what the fragment carries. The source is not
          // installed, so this names a place rather than opening one — and it is still the only
          // honest thing to print: the fault is in that file, in that package.
          file: at.file,
          line: at.line,
          column: at.column,
          provides: new Set(),
          consumes: new Map(),
          mounts: [],
          slotHoles: [],
          slots: node.slots ?? [],
          exported: node.exported === true,
          uses: new Set(),
          // Where the package stopped, this run stops too.
          opaque: node.opaque === true,
          usesChildren: true,
        };
        byId.set(node.id, made);
        splicedNodes.push(made);
        if (made.exported) {
          // Keyed by the NAME an app imports, which is the only handle it has. Two exported
          // classes with one name is the merge this branch removed everywhere else, so it is
          // refused rather than resolved to whichever came last.
          if (here.components.has(made.name)) {
            notes.push(`${name}'s graph declares more than one exported \`${made.name}\`, so neither is spliced`);
            here.components.delete(made.name);
            ambiguous.add(made.name);
          } else if (!ambiguous.has(made.name)) here.components.set(made.name, made);
        } else if (here.internals.has(made.name)) {
          // Refused for the same reason the exported branch above refuses: a kit member bound to
          // whichever class came first puts every edge below it under an arbitrary component, and a
          // wrong answer is worse than a missing one. The tag then reports as the hole it is.
          //
          // No note, unlike the exported branch. Internal names collide often — this repository's
          // documentation app declares `class Page` seventy-five times — and almost none of them is
          // ever reached by a factory's destructured key. A note per collision would bury the runs
          // where it matters; the unresolved edge says it at the one place it does.
          here.internals.delete(made.name);
          ambiguousInternals.add(made.name);
        } else if (!ambiguousInternals.has(made.name)) {
          here.internals.set(made.name, made);
        }
      } else if (node.kind === "context") {
        const fact: ContextFact = {
          id: node.id,
          graphId: node.id,
          at: node.at,
          provider: node.provider,
          consumer: node.consumer,
          label: node.label ?? node.name ?? "context",
          optional: node.optional === true,
          single: node.single === true,
        };
        contexts.set(fact.id, fact);
        if (node.provider) here.contexts.set(node.provider, { fact, half: "provides" });
        if (node.consumer) here.contexts.set(node.consumer, { fact, half: "consumes" });
      }
    }

    for (const each of fragment.graph.edges) {
      const from = byId.get(each.from);
      if (!from) continue;
      const target = each.to === undefined ? undefined : byId.get(each.to);
      if (each.kind === "renders" && target) {
        const binds = new Map<string, ComponentNode[]>();
        for (const bound of each.binds ?? []) {
          const to = byId.get(bound.to);
          if (!to) continue;
          const already2 = binds.get(bound.slot);
          if (already2) already2.push(to);
          else binds.set(bound.slot, [to]);
        }
        from.mounts.push({ target, binds, always: each.always === true });
      } else if (each.kind === "provides" && each.to) {
        from.provides.add(each.to);
      } else if (each.kind === "consumes" && each.to) {
        const at = splitWhere(each.at);
        if (!from.consumes.has(each.to)) from.consumes.set(each.to, { line: at.line, column: at.column });
      } else if (each.kind === "uses" && target) {
        from.uses.add(target);
      } else if (each.kind === "calls" && target) {
        from.mounts.push({ target, binds: new Map(), always: each.always === true });
      } else if (each.kind === "unresolved" && each.via === "slot" && each.slot) {
        from.slotHoles.push({ slot: each.slot });
      }
      /**
       * Carried into the app's graph as written, so a report can name the real path THROUGH the
       * package rather than stopping at its surface — unless it names a node nothing declares.
       *
       * A fragment is pruned to its own package, so an edge may point at another package's node;
       * if that package's fragment is not here, copying the edge would leave the emitted file with
       * a `to` that matches no node, which a reader has to treat as corrupt. Kept as a hole
       * instead, with the reason, which is the fact rather than the reference.
       */
      if (each.to !== undefined && !byId.has(each.to) && !declaredElsewhere(each.to)) {
        edges.push({
          from: each.from,
          kind: "unresolved",
          via: each.via,
          at: each.at,
          why: `\`${each.to}\` is declared by a package whose graph this run does not have`,
        });
      } else {
        edges.push(each);
      }
    }

    // A context a fragment declares OPTIONAL is one the walk must not report, and the walk reads
    // `consumes` — which the loop above fills regardless. Drop those, as the local pass does.
    for (const node of byId.values()) {
      for (const contextId of [...node.consumes.keys()]) {
        if (contexts.get(contextId)?.optional) node.consumes.delete(contextId);
      }
    }

    splicedPackages.set(root, here);
    return here;
  }

  /**
   * The declaration file this package publishes, fingerprinted at the moment the graph is written.
   *
   * A consumer has `dist` and not the source, so the source hash above is not a check it can make.
   * This is: rebuild the package and forget to regenerate its graph, and every app refuses the
   * fragment rather than trusting a map of code that is gone.
   */
  function describedFile(packageRoot: string): { describes: { file: string; hash: string } } | undefined {
    const entry = declarationEntryOf(packageRoot);
    if (!entry) return undefined;
    const hash = fingerprint(entry);
    if (!hash) return undefined;
    return { describes: { file: relative(packageRoot, entry).split(sep).join("/"), hash } };
  }

  /**
   * Whether some other source in this run declares that node — a package compiled from source, or
   * a fragment already spliced. Asked only to decide whether an edge's target can be named.
   */
  function declaredElsewhere(id: string): boolean {
    for (const node of components.values()) if (node.id === id) return true;
    for (const node of splicedNodes) if (node.id === id) return true;
    for (const helper of helpers.values()) if (helper.id === id) return true;
    for (const site of outletSites.values()) if (site.id === id) return true;
    return contexts.has(id);
  }

  /** `@acme/ui/src/Grid.tsx:10:3` back into its three parts. */
  function splitWhere(where: string): { file: string; line: number; column: number } {
    const match = /^(.*):(\d+):(\d+)$/.exec(where);
    if (!match) return { file: where, line: 1, column: 1 };
    return { file: match[1], line: Number(match[2]), column: Number(match[3]) };
  }

  /**
   * Why a name did not reach a component, said precisely enough to act on.
   *
   * The distinction that matters is between "nothing declares this" and "it is declared in a
   * package this run does not read" — the second is what a manifest exists to close, and telling
   * a reader to go looking for a missing class when the class is in `node_modules` sends them
   * nowhere.
   */
  function whyUnresolved(node: ts.Node | undefined, what: string): string {
    if (!node) return `${what} is not a component element`;
    const text = node.getText();
    if (!ts.isIdentifier(node)) return `\`${text}\` is not a plain name, so nothing can say what it mounts`;
    const declaration = resolve(node)?.declarations?.[0];
    if (!declaration) return `\`${text}\` does not resolve to a declaration`;
    const file = declaration.getSourceFile();
    if (file.isDeclarationFile || file.fileName.includes("node_modules")) {
      return `\`${text}\` is declared in ${pathOf(file.fileName)}, which this run does not read`;
    }
    if (ts.isVariableDeclaration(declaration)) {
      return `\`${text}\` is a variable, and what it holds cannot be read from where it is declared`;
    }
    if (ts.isParameter(declaration)) return `\`${text}\` is a parameter, so only a caller can say what it mounts`;
    return `\`${text}\` does not name a component class`;
  }

  function readClassBody(cls: ts.ClassDeclaration, self: ComponentNode): void {
    ts.forEachChild(cls, function visit(node) {
      // this.use(X), and `this.use(X<T>)` — see `hookNamed`.
      if (ts.isCallExpression(node) && isThisUse(node)) {
        const arg = node.arguments[0];
        const named = arg === undefined ? undefined : hookNamed(arg);
        const symbol = named !== undefined && ts.isIdentifier(named) ? resolve(named) : undefined;
        if (!symbol) {
          // A hook picked at runtime: it might be any provider, so nothing below can be judged.
          if (arg) {
            self.opaque = true;
            unresolvedEdge(self.id, "use", node, whyUnresolved(named, "the hook"), named);
          }
        } else {
          const provided = providerSymbols.get(symbol);
          if (provided) {
            self.provides.add(provided.id);
            edge(self.id, provided.graphId, "provides", "use", node);
          }
          const consumed = consumerSymbols.get(symbol);
          if (consumed) edge(self.id, consumed.graphId, "consumes", "use", node);
          // The WALK skips an optional context — its default is a real answer — but the graph
          // records the fact either way. A rule that wants to say "nobody provides this at all"
          // reads the edge; the provider check reads `consumes`.
          if (consumed && !consumed.optional && !self.consumes.has(consumed.id)) {
            self.consumes.set(consumed.id, positionOf(node));
          }
          // A hook can carry a context for its owner — `this.use(Router)` is how the router
          // publishes its own. Whatever that hook provides or consumes, the owner does too.
          const usedClass = components.get(symbol);
          if (usedClass && !provided && !consumed) {
            self.uses.add(usedClass);
            edge(self.id, usedClass.id, "uses", "use", node);
          }
          /**
           * The name resolved to a DECLARATION but not to anything this run knows — which is what
           * a hook imported from a package installed rather than compiled looks like. It was
           * silent: no edge, no hole, and a context that hook publishes invisible.
           *
           * `apps/playground-core` is the live case. It has no `paths` entry for `@ramonda/form`,
           * so `this.use(Form<typeof schema>)` reaches `packages/form/dist/index.d.ts` and the
           * package's whole composition drops out. This is the edge a manifest exists to close.
           */
          if (!usedClass && !provided && !consumed && named) {
            // The package may ship a fragment, in which case its hooks and contexts are known
            // after all — this is exactly the boundary a fragment exists to cross.
            const across = splicedFor(symbol);
            const context = across?.contexts.get(symbol.name);
            const hook = across?.components.get(symbol.name);
            if (context) {
              if (context.half === "provides") self.provides.add(context.fact.id);
              else if (!context.fact.optional && !self.consumes.has(context.fact.id)) {
                self.consumes.set(context.fact.id, positionOf(node));
              }
              edge(self.id, context.fact.graphId, context.half, "use", node);
            } else if (hook) {
              self.uses.add(hook);
              edge(self.id, hook.id, "uses", "use", node);
            } else {
              /**
               * A hook that is a PARAMETER blinds the walk below it; one merely declared elsewhere
               * does not.
               *
               * The distinction is not cosmetic and the fixtures pin both halves. `this.use(hook)`
               * with a bare parameter resolves to a symbol — the parameter's — so it lands here
               * rather than in the `!symbol` branch that marks opacity, and it used to end in a
               * reported hole, which is why the omission never showed. It showed the moment the
               * hole went silent: a consumer below was reported against a component that may well
               * have been providing for it.
               *
               * Widening this to everything that reaches here is the OTHER fault, and `pinned-hook`
               * catches it: `this.use(Form<typeof schema>)` arrives here too, and marking that
               * opaque leaves every consumer under a form or a query unjudged — which is what it
               * used to do.
               */
              if (slotFromParameter(named) !== undefined) self.opaque = true;
              unresolvedEdge(self.id, "use", node, whyUnresolved(named, "the hook"), named);
            }
          }
        }
      }

      collectCall(node, self);
      collectFactory(node, self);

      // <RouteOutlet routes={routes} /> — the views mount under the OUTLET, not under the
      // component that renders it. The distinction matters: the outlet is what publishes the
      // matched params, so hanging the views off this component would step over that provider.
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const { table, views } = routeViewsOf(node);
        if (views.length > 0) {
          const outlet = outletSite(node, self);
          if (table) mountedTables.set(table, [...(mountedTables.get(table) ?? []), outlet]);
          for (const { target, site } of views) {
            if (target) {
              mount(outlet, target, "route", site);
            } else {
              unresolvedEdge(outlet.id, "route", site, whyUnresolved(site, "the route's view"));
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    });

    // JSX ownership needs its own walk, because children of a COMPONENT element belong to that
    // component, not to the class whose render() wrote them.
    ts.forEachChild(cls, (n) => walkJsx(n, self, self));
  }

  /**
   * Attributes and children of `<C>` belong to C (it decides where and whether to render them);
   * everything else belongs to the enclosing component.
   */
  function walkJsx(node: ts.Node, owner: ComponentNode, self: ComponentNode): void {
    if (readElsewhere(node)) return;
    // Checked here rather than beside a component tag's children: `{Named}` almost always sits
    // inside a plain `<div>`, and an intrinsic element is never walked as a tag at all. The PARENT
    // is what separates a child from an attribute's value, which is a binding and not this.
    if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      namedWhereAnElementWasMeant(node);
    }
    /**
     * A function declared inside this one is a helper of its own, and its tags are ITS edges.
     *
     * Walking a helper's body whole gave the inner function's tag two owners — `inner -> Other`
     * and `outer -> Other`, from the same line, with `outer` never writing it. Define the inner
     * one and never call it and the outer still claimed to render it.
     */
    const nested = helperAt(node);
    if (nested && nested !== self) return;
    if (jsxTagName(node)) {
      const element = ts.isJsxElement(node) ? node : undefined;
      const opening = element ? element.openingElement : (node as ts.JsxSelfClosingElement);
      const child = componentAt(opening.tagName);
      // The tag is written in `self`'s body; when the OWNER is somebody else, it is written as
      // that component's children, which is a different fact and a different message.
      const via = owner === self ? "tag" : "children";
      if (child) {
        mount(owner, child, via, opening, bindingsIn(opening));
      } else {
        /**
         * A tag naming a PROP — `<this.props.view />`. Nothing in this class can say what it is,
         * and that is not a defect: the caller decides. It is recorded against the class whose
         * props it is, and the walk fills it from the bindings it arrives with.
         *
         * The hole belongs to `self` even when the tag sits inside another component's children,
         * which reads the mount point one level higher than it is. Nothing in this repository
         * writes that shape; when something does, the fix is to carry the owner on the hole.
         */
        const slot = slotPathOf(opening.tagName);
        if (slot) {
          self.slotHoles.push({ slot });
          edges.push({
            from: self.id,
            kind: "unresolved",
            via: "slot",
            at: whereOf(opening),
            slot,
            why: `\`${opening.tagName.getText()}\` is a prop, so only a caller can say what it mounts`,
          });
          readDirective(opening, "slot");
        } else {
          unresolvedEdge(owner.id, via, opening, whyUnresolved(opening.tagName, "the tag"), opening.tagName);
        }
      }

      /**
       * `<AsyncLoad lazy={…} />` — the loaded component mounts under the OWNER, not under
       * `AsyncLoad`.
       *
       * `AsyncLoad` is one shared class, so hanging its targets off it would put every lazily
       * loaded component in the app on one node and make each reachable from every other — the
       * same merge the name-keyed map used to make. It is safe to attribute them to the owner
       * because `AsyncLoad` neither provides nor consumes a context, so nothing sits between the
       * two that a walk would step over. `RouteOutlet` is the opposite case and keeps its views:
       * it publishes the matched params, and its views have to be below that provider.
       */
      for (const { target, site } of lazyTargets(opening) ?? []) {
        if (target) {
          mount(owner, target, "lazy", site);
        } else {
          unresolvedEdge(owner.id, "lazy", site, whyLazyUnresolved(site));
        }
      }

      const nested = child ?? owner;
      // Only descend into a component's children if it can actually mount them.
      const inner = child && !child.usesChildren ? owner : nested;
      if (element) for (const c of element.children) walkJsx(c, inner, self);
      for (const attr of opening.attributes.properties) walkJsx(attr, nested, self);
      return;
    }
    ts.forEachChild(node, (n) => walkJsx(n, owner, self));
  }

  /**
   * A hook's contexts are its owner's. `this.use(Router)` provides Route because Router itself
   * uses the provider; `this.use(Navigator)` consumes Route for the same reason one level down.
   * Run to a fixpoint so a hook built out of hooks resolves too.
   */
  function resolveHookContexts(): void {
    /**
     * Every node that can hold a `uses` edge, not just the ones read from THIS project's source.
     *
     * A component spliced in from a package's fragment carries hooks like any other, and a hook is
     * how a component publishes a context for its own subtree. Iterating `components` alone left
     * those unpropagated: the package's own run judged `DataGrid` clean, and an app that installed
     * it reported the consumer under it as having no provider — the same code, two verdicts, and
     * the wrong one is the one that fails a build.
     */
    const carriers = [...components.values(), ...splicedNodes, ...helpers.values(), ...outletSites.values()];
    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      for (const node of carriers) {
        for (const used of node.uses) {
          if (used.opaque && !node.opaque) {
            node.opaque = true;
            changed = true;
          }
          for (const id of used.provides) {
            if (!node.provides.has(id)) {
              node.provides.add(id);
              changed = true;
            }
          }
          // Consumption is deliberately NOT propagated. A hook that *can* read a context does
          // not mean its owner does: `Navigator` uses the params consumer, but a nav bar that
          // only reads `pathname` never touches params — and reporting it would be an accusation
          // against correct code. Providing propagates because it can only ever silence a report,
          // never raise one; consuming would do the opposite, so it stays with the class that
          // writes `this.use(SomeConsumer)` itself.
        }
      }
      if (!changed) return;
    }
    // Ten passes and still moving. Whatever is left unpropagated can only cause a report against
    // code that is in fact covered, so it is said out loud rather than left to look like a verdict.
    notes.push(
      "a hook chain is deeper than this resolves in ten passes, so a context carried through it may be reported as missing",
    );
  }

  // ── the walk ────────────────────────────────────────────────────────────────────────────────

  /**
   * What no root reaches, once the walk has been everywhere it can.
   *
   * Read from the same traversal that judges providers, so the two can never disagree about what is
   * mounted. Nothing spliced: another package's internals are its business, and this app not using
   * one of them says nothing about the package.
   */
  /**
   * A route table whose views can never appear.
   *
   * Two ways to get there, and a reader fixes them differently. Nothing hands the table to a
   * `<RouteOutlet>` this run can see — it was written and then never mounted, and the JSX walk skips
   * a bound table on the grounds that `collectRouteTable` read it, so without this nobody reads it
   * at all. Or an outlet does name it and no root reaches that outlet, which strands every page
   * under it.
   *
   * Each page in such a table looks perfectly well formed on its own, which is why nothing else
   * reports it.
   */
  /**
   * A ring of mounts that nothing on it can skip.
   *
   * Only the sites that run on EVERY render are followed, so a tree that renders itself once per
   * item — a callback, a branch, a loop — is not one of these. What is left cannot stop.
   *
   * Reported once per ring rather than once per member, at the class the ring is entered by: it is
   * one fault, and naming each component on it would be the same sentence three times.
   */
  function endlessRings(): RenderCycleIssue[] {
    const found: RenderCycleIssue[] = [];
    const state = new Map<ComponentNode, "open" | "done">();
    const stack: ComponentNode[] = [];
    const reported = new Set<string>();

    const walkFrom = (node: ComponentNode): void => {
      state.set(node, "open");
      stack.push(node);
      for (const site of node.mounts) {
        if (!site.always) continue;
        const next = site.target;
        if (state.get(next) === "open") {
          const ring = stack.slice(stack.indexOf(next));
          // One ring, one report: whichever member is met first names it, and the same ring found
          // from another entry point is the same fault.
          const key = [...ring]
            .map((n) => n.id)
            .sort()
            .join("|");
          if (!reported.has(key)) {
            reported.add(key);
            found.push({
              path: [...ring.map((n) => n.name), next.name],
              file: next.file,
              line: next.line,
              column: next.column,
            });
          }
        } else if (!state.has(next)) walkFrom(next);
      }
      stack.pop();
      state.set(node, "done");
    };

    for (const node of [...components.values(), ...helpers.values()]) if (!state.has(node)) walkFrom(node);
    return found;
  }

  function strandedRoutes(reached: Set<ComponentNode>): UnreachableRouteIssue[] {
    // No root, no verdict — the same reason a library is not judged for dead declarations.
    if (roots.size === 0) return [];
    const found: UnreachableRouteIssue[] = [];
    for (const [symbol, views] of routeTables) {
      if (views.length === 0) continue;
      const outlets = mountedTables.get(symbol) ?? [];
      const why =
        outlets.length === 0 ? "unmounted" : outlets.some((outlet) => reached.has(outlet)) ? undefined : "stranded";
      if (why === undefined) continue;
      found.push({ views: views.length, why, ...positionOf(views[0]) });
    }
    return found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  }

  function deadOnes(reached: Set<ComponentNode>): UnreachableIssue[] {
    // No root, no verdict: in a library everything is unreachable by definition.
    if (roots.size === 0) return [];
    /**
     * This project's OWN declarations, and nothing else.
     *
     * These apps compile their dependencies from source, so `components` holds core's and the
     * router's classes too — and an app not using one of core's hooks says nothing about core.
     * Measured before the filter: the playground reported `Provider` from
     * `@ramonda/core/src/base/Context.ts` as dead.
     */
    /**
     * Everything a reached node USES is reached too.
     *
     * The walk follows what MOUNTS, and a hook mounts nothing — `this.use(Counter)` is a `uses`
     * edge and never a mount, which is right for the provider check and wrong for this one.
     * Measured without it: `AppHook`, `CounterHook` and `HistoryHook` were all reported as dead
     * while a component used each of them one line away.
     */
    const queue = [...reached];
    while (queue.length > 0) {
      const node = queue.pop();
      if (!node) continue;
      for (const used of node.uses) {
        if (reached.has(used)) continue;
        reached.add(used);
        queue.push(used);
      }
    }

    const home = owner(projectRoot);
    const ours = home ? `${home.name}/` : undefined;
    const found: UnreachableIssue[] = [];
    for (const node of [...components.values(), ...helpers.values()]) {
      if (reached.has(node) || node.exported) continue;
      if (ours !== undefined && !node.id.startsWith(ours)) continue;
      found.push({ name: node.name, kind: node.kind, file: node.file, line: node.line, column: node.column });
    }
    return found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  }

  function walk(reached: Set<ComponentNode>): ContextIssue[] {
    const issues: ContextIssue[] = [];
    const seen = new Set<string>();
    const seenSeconds = new Set<string>();

    for (const root of rootMounts) {
      visit(root.target, new Set(), [], new Set(), new Map());
    }

    return issues;

    /**
     * `bound` is what the SITE that mounted this node handed to its slots.
     *
     * It travels with the path rather than living on the class, because `<Slot view={Reader} />`
     * in one place and `<Slot view={Writer} />` in another are two arrangements: merged onto
     * `Slot`, each would be reachable from the other and a provider above one would appear to
     * cover the other.
     */
    function visit(
      node: ComponentNode,
      provided: Set<string>,
      path: string[],
      onPath: Set<string>,
      bound: Map<string, ComponentNode[]>,
      /**
       * Whether a context verdict may be produced here — false once an OPAQUE node is above.
       *
       * Two questions used to share one early return, and they are not the same question. What a
       * component PROVIDES is unknowable below an opaque one, so no consumer under it can be
       * judged. What it MOUNTS is written in its body and perfectly visible. Stopping the descent
       * answered the first and broke the second: everything below was unreached, and the
       * dead-declaration rule read that as "nothing mounts this" while the tag sat one line above
       * it in the same file.
       */
      judging = true,
    ): void {
      /**
       * Keyed on the node AND what is bound to its slots, because those are different arrangements.
       *
       * Keyed on the node alone, a component that mounts itself with another component in a slot —
       * a tree renderer — was cut on the second arrival, and the second arrangement's subtree was
       * never judged. The depth cap is the backstop: a binding that grows on every turn would
       * otherwise make each arrival a new key.
       */
      const key = `${node.id}|${[...bound]
        .map(([slot, targets]) => `${slot}=${targets.map((t) => t.id).join(",")}`)
        .sort()
        .join(";")}`;
      if (onPath.has(key) || path.length > PATH_LIMIT) return;
      reached.add(node);

      const here = new Set(provided);
      const nextPath = [...path, node.name];
      for (const id of node.provides) {
        /**
         * Already provided ABOVE, and its author says two conflict.
         *
         * Checked before this node's own are added, so `provided` is strictly the ancestry. Deduped
         * per context and component: one class mounted on ten paths is one fault to fix.
         */
        if (judging && provided.has(id) && contexts.get(id)?.single === true && !seenSeconds.has(`${id}@${node.id}`)) {
          seenSeconds.add(`${id}@${node.id}`);
          secondProviders.push({
            context: contexts.get(id)?.label ?? "context",
            provider: node.name,
            path: nextPath,
            file: node.file,
            line: node.line,
            column: node.column,
          });
        }
        here.add(id);
      }

      for (const [contextId, where] of node.consumes) {
        if (!judging || here.has(contextId)) continue;
        const key = `${contextId}@${node.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({
          context: contexts.get(contextId)?.label ?? "context",
          consumer: node.name,
          file: node.file,
          line: where.line,
          column: where.column,
          path: nextPath,
        });
      }

      // An opaque class may provide anything, so nothing below it can be judged — but it is still
      // walked, because what it mounts is written in its body.
      const judgeBelow = judging && !node.opaque;

      const nextOnPath = new Set(onPath).add(key);
      for (const site of node.mounts) visit(site.target, here, nextPath, nextOnPath, site.binds, judgeBelow);
      // A tag naming a prop mounts whatever this caller handed over. With nothing bound the hole
      // stays a hole: the analyzer says nothing rather than guessing, which is what makes a report
      // here safe to fail a build on.
      for (const hole of node.slotHoles) {
        for (const filled of bound.get(hole.slot) ?? [])
          visit(filled, here, nextPath, nextOnPath, new Map(), judgeBelow);
      }
    }
  }

  // ── small helpers ───────────────────────────────────────────────────────────────────────────

  function resolve(id: ts.Node): ts.Symbol | undefined {
    let symbol = checker.getSymbolAtLocation(id);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol;
  }

  /**
   * The symbol as WRITTEN, alias unfollowed — the other half of `resolve`.
   *
   * `late-request-read` is the rule that needs it: an app is entitled to its own function called
   * `requestContext`, so identity is the module specifier the reader typed, and reaching that means
   * holding the local symbol whose declaration is the `ImportSpecifier` itself. Followed through
   * the alias, the declaration is core's and says nothing about how this file reached it.
   */
  function resolveLocal(id: ts.Node): ts.Symbol | undefined {
    return checker.getSymbolAtLocation(id);
  }

  function bindingSymbol(element: ts.ArrayBindingElement | undefined): ts.Symbol | undefined {
    if (!element || !ts.isBindingElement(element) || !ts.isIdentifier(element.name)) return undefined;
    return checker.getSymbolAtLocation(element.name);
  }

  /**
   * `<AsyncLoad lazy={…} namedExport="Page" />` — the component in another chunk.
   *
   * This is the largest edge kind an app has and it is not a tag: the documentation site reaches 75
   * of its 76 lazily-loaded components through one attribute. Nothing is guessed — the module is a
   * string LITERAL, which `ts.resolveModuleName` answers, and `namedExport` is a string literal
   * saying which export to take, so the class is named rather than inferred.
   *
   * **The constraint is not ours to impose.** A bundler can only split what it can see statically,
   * so a loader this cannot read is one no bundler could split either.
   */
  function lazyTargets(opening: ts.JsxOpeningLikeElement): Reference[] | undefined {
    const attribute = opening.attributes.properties.find(
      (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "lazy",
    );
    const loader =
      attribute?.initializer && ts.isJsxExpression(attribute.initializer)
        ? attribute.initializer.expression
        : undefined;
    if (!attribute || !loader) return undefined;

    const named = opening.attributes.properties.find(
      (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "namedExport",
    );
    const asked = named?.initializer;
    if (
      asked &&
      !(
        ts.isStringLiteral(asked) ||
        (ts.isJsxExpression(asked) && asked.expression && ts.isStringLiteral(asked.expression))
      )
    ) {
      return [{ target: undefined, site: attribute }];
    }
    const exportName = asked
      ? ts.isStringLiteral(asked)
        ? asked.text
        : ((asked as ts.JsxExpression).expression as ts.StringLiteral).text
      : "default";

    const { literals, computed } = importsUnder(loader);
    const references: Reference[] = literals.map((literal) => ({
      target: classExported(literal, exportName),
      site: literal,
    }));
    // A specifier built at runtime: no bundler can split it either, so there is nothing to name.
    for (let i = 0; i < computed; i += 1) references.push({ target: undefined, site: attribute });
    if (references.length === 0) references.push({ target: undefined, site: attribute });
    return references;
  }

  /**
   * Every `import("…")` a loader can reach, written where it may be.
   *
   * Three shapes, all measured in this repository: written in the JSX; behind ONE hop to a static
   * field or a module const, which is where `RMD020` pushes it (a fresh arrow in the JSX is a new
   * prop on every render); and a literal registry indexed by a runtime key, which is a union of its
   * values. The body is searched rather than read as a single expression, because a loader that
   * retries or races still reaches its module — and `may reach` is the semantics wanted anyway.
   */
  function importsUnder(expression: ts.Expression): { literals: ts.StringLiteralLike[]; computed: number } {
    const found = scanImports(expression);
    if (found.literals.length > 0 || found.computed > 0) return found;

    if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
      const behind = initializerBehind(expression);
      return behind ? scanImports(behind) : found;
    }
    if (ts.isElementAccessExpression(expression)) {
      const registry = initializerBehind(expression.expression);
      if (!registry || !ts.isObjectLiteralExpression(registry)) return found;
      const union = { literals: [] as ts.StringLiteralLike[], computed: 0 };
      for (const property of registry.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const value = scanImports(property.initializer);
        union.literals.push(...value.literals);
        union.computed += value.computed;
      }
      return union;
    }
    return found;
  }

  function scanImports(node: ts.Node): { literals: ts.StringLiteralLike[]; computed: number } {
    const literals: ts.StringLiteralLike[] = [];
    let computed = 0;
    (function scan(current: ts.Node) {
      if (ts.isCallExpression(current) && current.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = current.arguments[0];
        if (specifier && ts.isStringLiteralLike(specifier)) literals.push(specifier);
        else computed += 1;
      }
      ts.forEachChild(current, scan);
    })(node);
    return { literals, computed };
  }

  /** One hop: the value a name was declared with, when the declaration carries an initializer. */
  function initializerBehind(expression: ts.Expression): ts.Expression | undefined {
    if (!ts.isIdentifier(expression) && !ts.isPropertyAccessExpression(expression)) return undefined;
    const declaration = resolve(expression)?.declarations?.[0];
    if (!declaration) return undefined;
    if (
      ts.isVariableDeclaration(declaration) ||
      ts.isPropertyDeclaration(declaration) ||
      ts.isPropertyAssignment(declaration)
    ) {
      return declaration.initializer;
    }
    return undefined;
  }

  /**
   * The component a module exports under a name.
   *
   * The specifier resolves against the file it is WRITTEN in, not the one holding the JSX — the
   * loaders of the documentation site live in a generated module, and measuring from the JSX
   * resolved 0 of its 75 pages while measuring from the module resolves all 75.
   */
  function classExported(specifier: ts.StringLiteralLike, exportName: string): ComponentNode | undefined {
    const resolved = ts.resolveModuleName(
      specifier.text,
      specifier.getSourceFile().fileName,
      program.getCompilerOptions(),
      ts.sys,
    ).resolvedModule;
    if (!resolved) return undefined;
    const file = program.getSourceFile(resolved.resolvedFileName);
    const moduleSymbol = file && checker.getSymbolAtLocation(file);
    if (!moduleSymbol) return undefined;
    let symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === exportName);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.declarations?.find(ts.isClassLike);
    const declared = declaration?.name && checker.getSymbolAtLocation(declaration.name);
    if (!declared) return undefined;
    // The module may be one this run does not read, in which case its package's fragment is where
    // the class is declared — a lazily loaded page from an INSTALLED package resolved to nothing
    // before, and the whole chunk went unjudged.
    return components.get(declared) ?? splicedFor(declared)?.components.get(declared.name);
  }

  /**
   * What a tag hands to the mounted component's slots — `<Slot view={Reader} />`.
   *
   * Walked to any DEPTH, keyed by the path it was found at: `view`, `spec.toolbar.right.inner`,
   * `spec.columns[].cell`. Depth costs nothing here — it is an object literal, an array and a
   * ternary, all of them syntax — and it is what makes a slot at depth five the same mechanism as
   * one at depth one, with a longer string. A ternary hands over BOTH arms, because the question
   * is what may reach, not what will.
   */
  function bindingsIn(opening: ts.JsxOpeningLikeElement): Map<string, ComponentNode[]> {
    const found = new Map<string, ComponentNode[]>();
    const add = (path: string, target: ComponentNode): void => {
      const already = found.get(path);
      if (already) already.push(target);
      else found.set(path, [target]);
    };

    const dig = (expression: ts.Expression, path: string, depth: number): void => {
      if (depth > SLOT_DEPTH) return;
      const target = componentAt(expression);
      if (target) {
        add(path, target);
        return;
      }
      // One hop through a module constant, which is where RMD020 pushes anything built the same
      // way on every render — `spec={SPEC}` rather than the literal in the JSX.
      // `depth + 1`, like every other branch: two constants that name each other are a runtime
      // error and ordinary syntax, and following them with the depth unchanged recursed until the
      // stack gave out — a build step that dies with a trace instead of a diagnostic, taking every
      // other check in the run with it.
      const behind = initializerBehind(expression);
      if (behind && behind !== expression) {
        dig(behind, path, depth + 1);
        return;
      }
      if (ts.isObjectLiteralExpression(expression)) {
        for (const property of expression.properties) {
          if (ts.isPropertyAssignment(property))
            dig(property.initializer, `${path}.${property.name.getText()}`, depth + 1);
          else if (ts.isShorthandPropertyAssignment(property))
            dig(property.name, `${path}.${property.name.text}`, depth + 1);
        }
        return;
      }
      if (ts.isArrayLiteralExpression(expression)) {
        for (const element of expression.elements) dig(element, `${path}[]`, depth + 1);
        return;
      }
      if (ts.isConditionalExpression(expression)) {
        dig(expression.whenTrue, path, depth);
        dig(expression.whenFalse, path, depth);
        return;
      }
      if (ts.isParenthesizedExpression(expression)) dig(expression.expression, path, depth);
    };

    for (const attribute of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attribute) || !attribute.initializer) continue;
      if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) continue;
      dig(attribute.initializer.expression, attribute.name.getText(), 1);
    }
    return found;
  }

  /**
   * The prop path a tag names, when it names one — `this.props.view` is `view`.
   *
   * Two shapes, which are the two people write: the member expression in the tag, and one hop
   * through a local const, since `<V />` reads better than `<this.props.view />`.
   */
  function slotPathOf(tagName: ts.Node): string | undefined {
    const direct = propPathOf(tagName);
    if (direct) return direct;
    if (!ts.isIdentifier(tagName)) return undefined;
    const declaration = resolve(tagName)?.declarations?.[0];
    if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer) return undefined;
    return propPathOf(declaration.initializer);
  }

  /**
   * The slot a mount waits on when the value it names came from a PARAMETER — `type`,
   * `options.wrapper`.
   *
   * **A prop and a parameter are the same fact through different doors: the caller decides.**
   * `<this.props.view />` has never been a defect, and neither is `__h(type, …)` inside a JSX
   * runtime — nothing in either body can say what it mounts, and nothing was meant to. Reporting
   * one and not the other made the framework apologise for being a framework: thirteen escape
   * hatches across this repository, seven of them this shape, against a plan whose own test is that
   * more than a handful means the rule is formulated wrongly.
   *
   * What this does NOT buy is coverage. Nothing fills these: the compiler calls `jsx`, and
   * `render(ui, { wrapper })` hands its wrapper through a call argument while bindings are read
   * from JSX attributes. The gain is a fact that says what it waits on instead of a blank that
   * says nothing.
   *
   * The cost, plainly: a mount whose value came from a parameter is no longer an error anywhere,
   * an app's own helper included. It is a marked blank rather than a reported one — the walk still
   * goes no further, and a component that hands its own hook over stays `opaque`, so nothing
   * beneath it is judged on a guess.
   *
   * A CALL is not one of these. `bootstrap(wrap(ui), container)` names a function, and reading
   * what it returns is dataflow — out of scope by decision, so those two sites keep their written
   * reason.
   */
  function slotFromParameter(node: ts.Node | undefined): string | undefined {
    if (!node) return undefined;
    // `hook as never` is the same name behind a cast, and the casts in this repository are all
    // written for the same reason: core's `ComponentClassKind` is not on the public type surface.
    const named = ts.isExpression(node) ? unwrapAs(node) : node;
    let root: ts.Node = named;
    while (ts.isPropertyAccessExpression(root)) root = root.expression;
    if (!ts.isIdentifier(root)) return undefined;
    const declaration = resolve(root)?.declarations?.[0];
    // A parameter of ANY enclosing function, not only the nearest: `renderHook` closes its
    // `hook` over a class declared inside it, and that is the same promise to the caller.
    if (!declaration || !ts.isParameter(declaration)) return undefined;
    return named.getText();
  }

  /** `this.props.a.b` → `a.b`; anything not rooted in `this.props` is not a slot. */
  function propPathOf(node: ts.Node): string | undefined {
    const parts: string[] = [];
    let current: ts.Node = node;
    while (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text);
      current = current.expression;
    }
    if (parts.length < 2 || current.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
    if (parts[0] !== "props") return undefined;
    return parts.slice(1).join(".");
  }

  /**
   * The prop paths a component's own type declares as taking a component.
   *
   * From `class Grid extends Component<GridProps>`, walking `GridProps` as SYNTAX: a type literal,
   * an array, a union, and one hop through a named interface or alias, carrying the path along.
   *
   * **It starts at the props type and stops at core's node types, and both halves are measured.**
   * A walk that merely hunted for the marker anywhere returned eleven slots in `@ramonda/core`, of
   * which eight were rubbish — `RamondaNode.name: ComponentClassKind` at depth four, reached
   * through `RamondaNode` → `VNode` → `.name`. A prop typed `RamondaNode` is a NODE the caller
   * already wrote, not a slot the caller fills.
   */
  function slotsOf(cls: ts.ClassDeclaration): string[] {
    const props = baseExpression(cls) ? heritageTypeArgument(cls) : undefined;
    if (!props) return [];
    const found: string[] = [];
    /**
     * Keyed on the declaration AND the path it was reached at.
     *
     * One set for the whole type meant a named type reached twice contributed slots only the first
     * time: `{ left: Panel; right: Panel }` gave `left.cell` and never `right.cell`, so a binding
     * handed to the second path had no declared slot to line up with.
     */
    const seen = new Set<string>();
    const mark = (declaration: ts.Node, path: string): boolean => {
      const key = `${path}|${declaration.getSourceFile().fileName}:${declaration.pos}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };

    const dig = (type: ts.TypeNode | undefined, path: string, depth: number): void => {
      if (!type || depth > SLOT_DEPTH) return;
      if (ts.isTypeReferenceNode(type)) {
        const name = type.typeName.getText();
        if (SLOT_MARKERS.has(name)) {
          if (path) found.push(path);
          return;
        }
        if (NOT_A_SLOT.has(name)) return;
        for (const argument of type.typeArguments ?? []) dig(argument, path, depth + 1);
        const declaration = resolve(type.typeName)?.declarations?.[0];
        if (!declaration || !mark(declaration, path)) return;
        if (ts.isInterfaceDeclaration(declaration))
          for (const member of declaration.members) digMember(member, path, depth + 1);
        else if (ts.isTypeAliasDeclaration(declaration)) dig(declaration.type, path, depth + 1);
        return;
      }
      if (ts.isArrayTypeNode(type)) return dig(type.elementType, `${path}[]`, depth + 1);
      if (ts.isTypeLiteralNode(type)) {
        for (const member of type.members) digMember(member, path, depth + 1);
        return;
      }
      if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
        for (const each of type.types) dig(each, path, depth);
        return;
      }
      if (ts.isParenthesizedTypeNode(type)) dig(type.type, path, depth);
      // A mapped type and a function returning a component are the two shapes syntax cannot
      // answer. Both are out of scope by decision: reading them means asking for a TYPE, and the
      // whole resolver is on symbols.
    };

    const digMember = (member: ts.TypeElement, path: string, depth: number): void => {
      if (!ts.isPropertySignature(member) || !member.type) return;
      dig(member.type, path ? `${path}.${member.name.getText()}` : member.name.getText(), depth);
    };

    dig(props, "", 0);
    return [...new Set(found)].sort();
  }

  /** `class Grid extends Component<GridProps>` — the props type, when one is written. */
  function heritageTypeArgument(cls: ts.ClassDeclaration): ts.TypeNode | undefined {
    for (const clause of cls.heritageClauses ?? []) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      return clause.types[0]?.typeArguments?.[0];
    }
    return undefined;
  }

  /**
   * What to write instead, as CODE.
   *
   * Most of the code this reports on will be written by an agent, and an agent acts on a patch far
   * more reliably than on advice. Each is the shape that IS resolvable, with the escape hatch as the
   * last line — because sometimes the honest answer is that the author knows something the resolver
   * cannot.
   */
  function fixFor(via: GraphEdge["via"]): string {
    const record = `// ramonda-check-ignore <why this cannot be resolved>`;
    switch (via) {
      case "tag":
      case "children":
        return `import { TheComponent } from "./the-module";\n<TheComponent />\n${record}`;
      case "lazy":
        return `lazy={() => import("./the-module")} namedExport="TheComponent"\n${record}`;
      case "factory":
        return `__h(TheComponent, props)\n// or, from a map written as a literal:\n__h(REGISTRY[key], props)\n${record}`;
      case "route":
        return `const routes = createRoutes({ "/": <TheView /> });\n<RouteOutlet routes={routes} />\n${record}`;
      case "bootstrap":
        return `bootstrap(<App />, element)\n${record}`;
      default:
        return `this.use(TheHook)\n${record}`;
    }
  }

  /** Why a loader named nothing, said where a reader can act on it. */
  function whyLazyUnresolved(site: ts.Node): string {
    if (ts.isStringLiteralLike(site)) return `\`${site.text}\` exports no component under the name this asks for`;
    return 'the loader has no `import("…")` with a literal specifier, so nothing can name what it loads';
  }

  function routeViewsOf(opening: ts.JsxSelfClosingElement | ts.JsxOpeningElement): {
    table?: ts.Symbol;
    views: Reference[];
  } {
    if (opening.tagName.getText() !== "RouteOutlet") return { views: [] };
    for (const attr of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "routes") continue;
      const value = attr.initializer;
      if (!value || !ts.isJsxExpression(value) || !value.expression) continue;
      if (!ts.isIdentifier(value.expression)) continue;
      const symbol = resolve(value.expression);
      const views = symbol ? routeTables.get(symbol) : undefined;
      if (views && symbol) return { table: symbol, views: views.map((site) => ({ target: componentAt(site), site })) };
    }
    return { views: [] };
  }

  // ── the graph ───────────────────────────────────────────────────────────────────────────────

  /**
   * Everything collected above, as the published format.
   *
   * A projection rather than a second walk: the issues and the graph are two readings of one pass,
   * so they cannot drift apart.
   */
  function buildGraph(): ComponentGraph {
    const nodes: GraphNode[] = [];
    for (const node of components.values()) {
      nodes.push({
        id: node.id,
        kind: node.kind,
        name: node.name,
        at: `${pathOf(node.file)}:${node.line}:${node.column}`,
        ...(node.exported ? { exported: true } : {}),
        ...(node.opaque ? { opaque: true } : {}),
        ...(node.slots.length > 0 ? { slots: node.slots } : {}),
      });
    }
    for (const fact of contexts.values()) {
      nodes.push({
        id: fact.graphId,
        kind: "context",
        name: fact.provider,
        at: fact.at,
        label: fact.label,
        provider: fact.provider,
        consumer: fact.consumer,
        optional: fact.optional,
        ...(fact.single ? { single: true } : {}),
      });
    }
    for (const node of [...helpers.values(), ...outletSites.values()]) {
      nodes.push({
        id: node.id,
        kind: node.kind,
        name: node.name,
        at: `${pathOf(node.file)}:${node.line}:${node.column}`,
        ...(node.exported ? { exported: true } : {}),
      });
    }
    for (const node of splicedNodes) {
      nodes.push({
        id: node.id,
        kind: node.kind,
        name: node.name,
        at: `${node.file}:${node.line}:${node.column}`,
        ...(node.exported ? { exported: true } : {}),
        ...(node.slots.length > 0 ? { slots: node.slots } : {}),
      });
    }
    nodes.push(...rootNodes);

    const hash = createHash("sha256");
    // Ordered by code unit, not by `localeCompare`: collation depends on the machine's locale and
    // ICU build, so the same sources could hash and diff differently on two machines.
    for (const file of [...sources].sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0))) {
      hash.update(pathOf(file.fileName));
      hash.update(file.text);
    }

    // The package the project SITS IN, so it matches the prefix every id carries. A fixture with
    // no package.json of its own belongs to the package above it, and saying otherwise would give
    // the graph two names for one thing.
    /**
     * Everything a reached node USES is reached too.
     *
     * The walk follows what MOUNTS, and a hook mounts nothing — `this.use(Counter)` is a `uses`
     * edge and never a mount, which is right for the provider check and wrong for this one.
     * Measured without it: `AppHook`, `CounterHook` and `HistoryHook` were all reported as dead
     * while a component used each of them one line away.
     */
    const queue = [...reached];
    while (queue.length > 0) {
      const node = queue.pop();
      if (!node) continue;
      for (const used of node.uses) {
        if (reached.has(used)) continue;
        reached.add(used);
        queue.push(used);
      }
    }

    const home = owner(projectRoot);
    /**
     * A root that names a component, not merely a call to `bootstrap`.
     *
     * `@ramonda/testing-library` calls `bootstrap` on a vnode it was handed — that is its whole
     * job — and a call whose argument nothing can name starts no tree. Counting it made every
     * package that maps testing-library in its tsconfig come out as an app.
     */
    const scope = roots.size > 0 ? "app" : "library";
    const ownedBy = home ? `${home.name}/` : undefined;
    /**
     * A library describes ITSELF.
     *
     * These packages compile their dependencies from source, so an unpruned fragment for
     * `@ramonda/router` carried `@ramonda/core`'s classes as well — the same nodes core's own
     * fragment declares, under the same ids. An app splices one fragment per package and gets each
     * one once; an edge that points into another package still resolves, because the id is the
     * same on both sides.
     */
    const owned = (id: string): boolean => scope === "app" || ownedBy === undefined || id.startsWith(ownedBy);

    return {
      schema: 1,
      // A library has no root, so "unreachable" and "no provider above" cannot be decided in it at
      // all — its graph is a fragment for an app to splice in, not a verdict.
      scope,
      package: home ? { name: home.name, version: packageOf(home.root).version } : packageOf(projectRoot),
      hash: `sha256:${hash.digest("hex")}`,
      ...(scope === "library" && home ? describedFile(home.root) : {}),
      nodes: nodes.filter((n) => owned(n.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      // Sorted so two runs over the same sources produce the same bytes, and a diff between two
      // commits is the change rather than the traversal order.
      edges: edges
        .filter((e) => owned(e.from))
        .sort((a, b) => {
          const left = `${a.from}${a.at}${a.to ?? ""}`;
          const right = `${b.from}${b.at}${b.to ?? ""}`;
          return left < right ? -1 : left > right ? 1 : 0;
        }),
    };
  }
}

// ── module-level helpers (no checker needed) ──────────────────────────────────────────────────

function calleeName(call: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return undefined;
}

function labelOf(call: ts.CallExpression): string | undefined {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  for (const prop of options.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (prop.name.getText() !== "label") continue;
    if (ts.isStringLiteral(prop.initializer)) return prop.initializer.text;
  }
  return undefined;
}

/**
 * A boolean option in `createContext(default, { … })`, read only when it is the literal `true`.
 * Anything computed reads as absent — and absent means "checked", so an unreadable value can
 * only ever produce a report the runtime would produce too, never silence one.
 */
function flagOf(call: ts.CallExpression, name: string): boolean {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  for (const prop of options.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (prop.name.getText() !== name) continue;
    return prop.initializer.kind === ts.SyntaxKind.TrueKeyword;
  }
  return false;
}

function bindingName(pattern: ts.ArrayBindingPattern, index: number): string | undefined {
  const element = pattern.elements[index];
  if (!element || !ts.isBindingElement(element) || !ts.isIdentifier(element.name)) return undefined;
  return element.name.text;
}

/** The opening element of a JSX node, whichever of the three shapes it is written in. */
function openingOf(node: ts.Node): ts.JsxOpeningLikeElement | undefined {
  return ts.isJsxElement(node)
    ? node.openingElement
    : ts.isJsxSelfClosingElement(node)
      ? node
      : ts.isJsxOpeningElement(node)
        ? node
        : undefined;
}

/** The component name of a JSX tag, if this node is a JSX element at all. */
function jsxTagName(node: ts.Node): string | undefined {
  const opening = openingOf(node);
  if (!opening) return undefined;
  const name = opening.tagName.getText();
  // Lowercase is an intrinsic element (`div`), which owns nothing — unless the tag is a member
  // expression (`<this.props.view />`, `<screens.reader />`), which is always a value reference and
  // never an element. Missing those made a tag naming a prop invisible rather than a hole.
  return /^[A-Z]/.test(name) || name.includes(".") ? name : undefined;
}

/** The `extends X` clause's expression, if the class has one at all. A class has at most one. */
function baseExpression(cls: ts.ClassLikeDeclaration): ts.Expression | undefined {
  for (const clause of cls.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    return clause.types[0]?.expression;
  }
  return undefined;
}

/**
 * The class a heritage expression names, through an import alias.
 *
 * Symbols only. A type would answer more shapes — a mixin's return type above all — and it would
 * bring back the 618 ms checker, `lib` and every `@types` package with it. What symbols cannot
 * follow is out of scope by decision, not by accident.
 */
function baseClass(base: ts.Expression, checker: ts.TypeChecker): ts.ClassLikeDeclaration | undefined {
  if (!ts.isIdentifier(base) && !ts.isPropertyAccessExpression(base)) return undefined;
  let symbol = checker.getSymbolAtLocation(base);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.declarations?.find((d): d is ts.ClassLikeDeclaration => ts.isClassLike(d));
}

/**
 * Whether some class in this one's heritage chain is Ramonda's `Component` or `Hook`.
 *
 * This used to read one clause and return `true` for a class extending ANYTHING, on the reasoning
 * that a subclass of a subclass still is one. It is — and so was `class MyError extends Error`.
 * Measured on the `heritage` fixture: of five classes, all five counted as components.
 *
 * Nearly harmless while the only cost was `counts.components`, which is printed to the user as a
 * fact — the docs app's number was inflated. Not harmless for anything computed from the graph:
 * "a component nobody renders" would call every `extends Error` dead code.
 *
 * The fix walks the chain rather than tightening the name check. Accepting only a literal
 * `extends Component` would drop `Deep extends Base`, which is a real component and today passes
 * only by the accident of that blanket `true`.
 */
function componentKind(cls: ts.ClassDeclaration, checker: ts.TypeChecker): "component" | "hook" | undefined {
  const seen = new Set<ts.ClassLikeDeclaration>();
  let current: ts.ClassLikeDeclaration | undefined = cls;
  while (current && !seen.has(current)) {
    seen.add(current);
    const base = baseExpression(current);
    if (!base) return undefined;
    const name = base.getText();
    if (name === "Hook" || name.endsWith(".Hook")) return "hook";
    if (name === "Component" || name.endsWith(".Component")) return "component";
    current = baseClass(base, checker);
  }
  return undefined;
}

/**
 * The name and version of the package the tsconfig sits in.
 *
 * They belong to the graph because two versions of one package can be installed at once: the node
 * ids collide while the graphs differ, so a fragment that does not say which version it describes
 * is a map that cannot be told from another map.
 */
function packageOf(dir: string): { name: string; version: string } {
  try {
    const raw = ts.sys.readFile(`${dir}/package.json`);
    if (raw) {
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name) return { name: parsed.name, version: parsed.version ?? "0.0.0" };
    }
  } catch {
    // A malformed package.json is `tsc`'s news to break, not this tool's.
  }
  return { name: dir.split(/[/\\]/).pop() ?? "app", version: "0.0.0" };
}

function createProgram(tsconfigPath: string): {
  program: ts.Program;
  notes: string[];
} {
  const notes: string[] = [];
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`[ramonda-check] could not read ${tsconfigPath}: ${configFile.error.messageText}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    // The tsconfig's own directory, which every relative path in it resolves against.
    //
    // This was `tsconfigPath.replace(/[^/\\]+$/, "")`, and CodeQL was right about it: on a path
    // whose last character IS a separator, `[^/\\]+$` can never match, so the engine retries from
    // every position and backtracks the whole run each time. Measured: 60k characters took 3.5s
    // and 120k took 15s — quadratic, plainly. Nobody types a path like that, but a one-line
    // regex is not worth defending when the standard library names the operation exactly.
    dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  );
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) notes.push(String(ts.flattenDiagnosticMessageText(error.messageText, " ")));
  }
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    /**
     * The project's own options, minus the two that load declaration files this analyzer will
     * never look at.
     *
     * It asks the checker exactly two things — `getSymbolAtLocation` and `getAliasedSymbol` —
     * both of which are binder work over the files it walks. It never asks for a TYPE, so
     * `Array`, `Promise` and the DOM are megabytes of parsing for nothing, and so is every
     * `@types/*` package a project happens to have installed.
     *
     * Measured on this repo's docs app (68 components): 2.4s → 0.35s, and on a small fixture
     * 214 source files → 2. That matters beyond a fast test suite — `ramonda-check`
     * runs FIRST in an app's `build`, so this was a second or more added to every build.
     *
     * `noLib` makes the program report errors about missing globals. Nothing here reads
     * diagnostics: the analyzer's job is to say which context has no provider, and a project
     * that does not compile is `tsc`'s news to break, not this tool's.
     */
    options: { ...parsed.options, noLib: true, types: [] },
  });
  return { program, notes };
}
