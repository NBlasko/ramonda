import { createHash } from "node:crypto";
import { dirname, relative, sep } from "node:path";
import ts from "typescript";
import { declarationEntryOf, fingerprint, loadFragment, packageRootOf } from "./fragment";
import type { ComponentGraph, GraphEdge, GraphNode, Where } from "./graph";

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
 * A class field holding a function literal.
 *
 * Ramonda binds every method to its instance, so `onPick = (id) => this.select(id)` buys exactly
 * nothing over `onPick(id) { this.select(id) }` — and costs one closure per instance, which for a
 * list of a thousand rows is a thousand closures.
 *
 * The check is syntactic on purpose. At runtime the two are indistinguishable: by the time anything
 * could look, `bindInstanceMethods` has already written a bound function onto the instance under
 * every method's name, and a field holding `debounce(this.save, 200)` is a function there too — and
 * that one is legitimate, because a wrapper cannot be expressed as a method. Only the source can
 * tell a function LITERAL from a call that returns one.
 */
export interface ArrowFieldIssue {
  /** The class the field is on. */
  component: string;
  field: string;
  file: string;
  line: number;
  column: number;
  /** Whether the body mentions `this` — which decides whether it becomes a method or leaves the class. */
  readsThis: boolean;
}

/**
 * A decorator that answers a question with ONE answer, declared more than once on the same class.
 *
 * `@catchError` ("who handles an error from below?"), `@Host` ("which element am I?"),
 * `@ShouldUpdateOnPropsChange` ("take these props?") and `@StableProps` are each single. Declared
 * twice, one of them wins and the others never run — silently, and the one being read may be the dead
 * one. The framework reports what it can at runtime (RMD032 for `@catchError`, RMD040 for
 * `@ShouldUpdateOnPropsChange`), but only once the class is reached; a class behind a condition nobody
 * clicked ships with the fault.
 *
 * **Which one wins depends on the KIND of decorator, and the two are opposite.** One rule underneath
 * both: the last declaration APPLIED is the one that stands. A member decorator initialises
 * top-to-bottom, so the LOWEST is applied last and wins. A class decorator is applied bottom-up, so the
 * HIGHEST wins. Measured in core, in `CatchErrorDecorator.test.tsx` and `PropsGateInheritance.test.tsx`
 * — which is why `kind` is on this issue: without it a report cannot name the declaration that is
 * actually in effect, and naming the wrong one sends a reader to delete the line that works.
 *
 * A SUBCLASS declaring its own is not this. That is an override — the way a role is specialised —
 * so only declarations on one class body are counted.
 */
export interface DuplicateDecoratorIssue {
  /** The class the duplicates are on. */
  component: string;
  /** The decorator's name, without the `@`. */
  decorator: string;
  /** How many times it appears on this class. */
  count: number;
  /**
   * Where the decorator sits, which decides which of the duplicates is in effect — see above.
   *
   * Taken from the node it was found on rather than from a table of names, so it stays true when a
   * decorator changes form (`@ShouldUpdateOnPropsChange` was a member decorator before it was a class
   * one). A pair split across both kinds cannot arise: a decorator's own type refuses the position it
   * was not written for.
   */
  kind: "class" | "member";
  /**
   * What the second declaration DOES, which decides what advice makes sense.
   *
   * Four, one per behaviour core actually has, because the advice differs for each and naming the wrong
   * one sends a reader somewhere there is nothing to find:
   *
   * - `refuses` — it THROWS (`@Host`, RMD045). Nothing runs, so there is no live line to hunt for.
   * - `displaces` — one wins and the rest are dead code (`@catchError` RMD032,
   *   `@ShouldUpdateOnPropsChange` RMD040). The reader needs to know WHICH is live.
   * - `merges` — both take effect and the result is the union (`@StableProps`, RMD046). Nothing is lost;
   *   the spelling is redundant.
   * - `redundant` — the second changes nothing at all (`@state`, `@compute`, `@persist`,
   *   `@memoizedHandler`). No dead code and no behaviour to look for; delete the extras.
   */
  effect: "refuses" | "displaces" | "merges" | "redundant";
  /**
   * The member the duplicates sit on, for a `redundant` report — `n` in `@state @state n = 1`.
   *
   * Absent for `displaces`, where the count is per class and naming one member would be misleading:
   * two `@catchError` are on two different methods, and the fault is that the class has two answers.
   */
  member?: string;
  file: string;
  line: number;
  column: number;
}

/**
 * A component that READS a form field it was handed, without watching it.
 *
 * Such a component never re-renders. Two things have to be true at once for that, and both are
 * deliberate: a field node is ONE cached object for the life of the form — a fresh one per access
 * means a fresh `bind.onInput` per access, which RMD020 reports — so the component's props never
 * change and the props diff skips it; and a hook's `@state` belongs to the component that used the
 * hook, so the form's counter wakes the form's OWNER and nobody else. The fix is `Field`, the hook
 * that subscribes the component to that one path.
 *
 * **Why this cannot be a runtime diagnostic.** The form would have to know who is rendering, and it
 * cannot: core's render phase is internal to core. Nothing in the running page can tell "the owner is
 * reading its own field" from "a child is reading a field it will never hear about again". Statically
 * it is plain, which is why it lives here — and it is the one silent failure the form package has
 * left, so it is worth a build gate rather than a note in the docs.
 *
 * **Only a READ counts.** A component that only WRITES through a field it was handed — `set` from a
 * click handler — is correct as written: writing needs no subscription, and the component showing the
 * value is somebody else. Reporting those would be reporting working code.
 */
export interface UnwatchedFieldIssue {
  /** The component doing the reading. */
  component: string;
  /** The member it read — `value`, `error`, `bind`, … — which is what would never update. */
  member: string;
  file: string;
  line: number;
  column: number;
}

export interface AnalyzeResult {
  issues: ContextIssue[];
  /** Function literals held in class fields — see `ArrowFieldIssue`. */
  arrowFields: ArrowFieldIssue[];
  /** Single-use decorators declared twice on one class — see `DuplicateDecoratorIssue`. */
  duplicateDecorators: DuplicateDecoratorIssue[];
  /** Form fields read by a component that does not watch them — see `UnwatchedFieldIssue`. */
  unwatchedFields: UnwatchedFieldIssue[];
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
  /** Exported context bindings, by the name of either half of the pair. */
  contexts: Map<string, { fact: ContextFact; half: "provides" | "consumes" }>;
}

/** One place that mounts a component, and what that place hands to the component's slots. */
interface MountSite {
  target: ComponentNode;
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
   * Everything that names a component — a JSX tag, `list({ as })`, a route table, `bootstrap` — is
   * resolved to its symbol and looked up here, so a tag also has to be in scope to match, which a
   * name lookup never checked.
   */
  id: string;
  /** Which of the two base classes the chain reaches — a hook mounts no children of its own. */
  kind: "component" | "hook";
  name: string;
  file: string;
  line: number;
  column: number;
  provides: Set<string>;
  /** context id → where it is consumed. */
  consumes: Map<string, { line: number; column: number }>;
  /** Components this one can render. */
  renders: Set<ComponentNode>;
  /**
   * One entry per SITE that mounts something, with whatever that site binds to a slot.
   *
   * The walk reads this rather than `renders`, because a binding belongs to a call and not to a
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

const CORE_ROOTS = new Set(["bootstrap", "hydrateRoot"]);

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

/**
 * A second declaration REFUSES the program: it throws, so nothing runs at all.
 *
 * `@Host` only. Two element names have no union and no winner worth picking, so core raises `RMD045` and
 * throws in every build. Reporting it as "one of them wins" would be worse than saying nothing — the
 * reader would go looking for which line is live when the answer is that the class never loads.
 */
const REFUSING = new Set(["Host"]);

/**
 * A second declaration DISPLACES the first: one wins, the rest never run, and the program carries on
 * wrongly. That is what a runtime code without a throw is for — `RMD032` and `RMD040`.
 *
 * Counted per CLASS BODY, so a subclass declaring its own — an override — is not a duplicate.
 */
const DISPLACING = new Set(["catchError", "ShouldUpdateOnPropsChange"]);

/**
 * A second declaration MERGES with the first, so both take effect and the result is the union.
 *
 * `@StableProps` only, and it follows from what the decorator IS: it names a set, and it already merges
 * along the class chain. Nothing is displaced and nothing is wasted — the author asked for the union and
 * got it, spelled twice. Core reports `RMD046`, a warning.
 */
const MERGING = new Set(["StableProps"]);

/**
 * The decorators where a second application changes NOTHING — a different fault, and worth its own
 * sentence, because telling somebody "one of them never runs" here would send them looking for a
 * behaviour difference that does not exist.
 *
 * Measured in core rather than assumed: `@state @state n = 1` renders once per write with the right
 * value, `@compute @compute` runs its body once for two reads, and `@persist` and `@memoizedHandler`
 * behave identically doubled. So it is redundancy, which is why it reads as a warning rather than a
 * broken program — the author believed something that is not so, and nothing downstream is wrong.
 *
 * `@watchProp` is deliberately NOT here: several on one method is the supported way for one handler to
 * follow several props, and each application does real work. See `DecoratorReach.test.tsx`, which pins
 * that it runs once per changed prop.
 */
const REDUNDANT_TWICE = new Set(["state", "compute", "persist", "memoizedHandler"]);

/**
 * The members of a field's API whose answer MOVES, which is what makes reading one a subscription.
 *
 * `set`, `reset`, `append`, `insert`, `remove` and `move` are absent on purpose: a component that only
 * writes through a field it was handed is correct as written, because writing needs no subscription.
 * `path` and `name` are absent because they are fixed for the life of the field — a component reading
 * only the `name` to label something has nothing to hear about.
 */
const FIELD_READS = new Set(["value", "error", "errors", "touched", "dirty", "bind", "rows", "length"]);

/** The hook that watches one field. Named rather than resolved — see `readUnwatchedFields`. */
const WATCH_HOOK = "Field";

/** The name of a decorator, whether it is bare (`@catchError`) or called (`@Host("div")`). */
/**
 * The hook a `this.use(...)` names, looking through a type argument list.
 *
 * `this.use(Form<typeof schema>, …)` is an INSTANTIATION EXPRESSION, not an identifier — and every
 * generic hook in the framework is documented to be written that way when the call site cannot infer:
 * `Form<typeof schema>`, `Query<Todo>`, `Field<string>`. Read as an identifier only, none of them
 * resolved, so the owning component was marked opaque and **every consumer below it stopped being
 * judged**. Proved by the `pinned-hook` fixture: with the pin unwrapped the missing provider is
 * reported, and without it the report is silence.
 */
function hookNamed(arg: ts.Expression): ts.Expression {
  return ts.isExpressionWithTypeArguments(arg) ? arg.expression : arg;
}

function decoratorName(decorator: ts.Decorator): string | undefined {
  const expression = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
  return ts.isIdentifier(expression) ? expression.text : undefined;
}

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

  /** Every component and hook class, by the symbol of its declaration — see `ComponentNode.id`. */
  const components = new Map<ts.Symbol, ComponentNode>();
  const arrowFields: ArrowFieldIssue[] = [];
  const duplicateDecorators: DuplicateDecoratorIssue[] = [];
  const unwatchedFields: UnwatchedFieldIssue[] = [];
  const roots = new Set<ComponentNode>();
  /** Package root → what its fragment contributed, or `null` for one that has none. */
  const splicedPackages = new Map<string, SplicedPackage | null>();
  /** Components and hooks a fragment brought in, which have no declaration to walk. */
  const splicedNodes: ComponentNode[] = [];
  /** One per `bootstrap`/`hydrateRoot` call, which is where a tree starts. */
  const rootNodes: GraphNode[] = [];
  /** Where each root's tree starts, for the walk. */
  const rootMounts: { id: string; target: ComponentNode }[] = [];
  const rootsPerFile = new Map<string, number>();
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
      const found = ts.sys.fileExists(`${dir}/package.json`)
        ? { name: packageOf(dir).name, root: dir }
        : up === dir
          ? undefined
          : undefined;
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
    edges.push({ from, to, kind, via, at: whereOf(site), ...(flat ? { binds: flat } : {}) });
  };

  /** Records a mount both ways: as an edge for the format, and as a SITE for the walk. */
  const mount = (
    owner: ComponentNode,
    target: ComponentNode,
    via: GraphEdge["via"],
    site: ts.Node,
    binds: Map<string, ComponentNode[]> = new Map(),
  ): void => {
    owner.renders.add(target);
    owner.mounts.push({ target, binds });
    edge(owner.id, target.id, "renders", via, site, binds);
  };
  const unresolvedEdge = (from: string, via: GraphEdge["via"], site: ts.Node, why: string): void => {
    edges.push({ from, kind: "unresolved", via, at: whereOf(site), why });
  };

  const sources = program.getSourceFiles().filter((f) => !f.isDeclarationFile && !f.fileName.includes("node_modules"));

  // ── Pass 1: the context pairs, the route tables, and every component class by symbol ────────
  for (const file of sources) {
    ts.forEachChild(file, function visit(node) {
      collectContextPair(node);
      collectRouteTable(node);
      collectClass(node);
      ts.forEachChild(node, visit);
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
          readArrowFields(node, self.name);
          readDuplicateDecorators(node, self.name);
          readUnwatchedFields(node, self.name);
        }
      }
      collectRoot(node);
      ts.forEachChild(node, visit);
    });
  }

  resolveHookContexts();
  const issues = walk();

  return {
    issues,
    arrowFields,
    duplicateDecorators,
    unwatchedFields,
    counts: {
      components: components.size,
      contexts: contexts.size,
      roots: roots.size,
    },
    graph: buildGraph(),
    notes,
  };

  // ── collection ──────────────────────────────────────────────────────────────────────────────

  /** `const [Theme, ThemeConsumer] = createContext({...}, { label: "Theme" })` */
  function collectContextPair(node: ts.Node): void {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    if (!ts.isCallExpression(node.initializer)) return;
    if (calleeName(node.initializer) !== "createContext") return;
    if (!ts.isArrayBindingPattern(node.name)) return;

    const pos = positionOf(node);
    const id = `${pos.file}:${pos.line}`;
    const label = labelOf(node.initializer) ?? bindingName(node.name, 1) ?? bindingName(node.name, 0) ?? "context";
    const providerName = bindingName(node.name, 0);
    const fact: ContextFact = {
      id,
      // The PROVIDER's binding name, because that is what an app mounts and what a message names.
      graphId: idFor(pos.file, providerName ?? label),
      at: whereOf(node),
      provider: providerName,
      consumer: bindingName(node.name, 1),
      label,
      optional: flagOf(node.initializer, "optional"),
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

    const views: ts.Node[] = [];
    ts.forEachChild(node.initializer, function scan(n) {
      const opening = openingOf(n);
      if (opening && jsxTagName(n)) views.push(opening.tagName);
      ts.forEachChild(n, scan);
    });
    routeTables.set(symbol, views);
  }

  function collectClass(node: ts.Node): void {
    if (!ts.isClassDeclaration(node) || !node.name) return;
    const kind = componentKind(node, checker);
    if (!kind) return;
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
      renders: new Set(),
      mounts: [],
      slotHoles: [],
      slots: slotsOf(node),
      exported: (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0,
      uses: new Set(),
      opaque: false,
      usesChildren: node.getText().includes("children"),
    });
  }

  /** `bootstrap(<App />, el)` / `hydrateRoot(<App />, el)` — where a tree starts. */
  function collectRoot(node: ts.Node): void {
    if (!ts.isCallExpression(node)) return;
    const name = calleeName(node);
    if (!name || !CORE_ROOTS.has(name)) return;
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
      unresolvedEdge(id, "bootstrap", node, whyUnresolved(opening?.tagName, `${name}'s first argument`));
    }
  }

  /** The component a name in value position refers to, resolved through an import alias. */
  function componentAt(node: ts.Node): ComponentNode | undefined {
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = resolve(node);
    if (!symbol) return undefined;
    return components.get(symbol) ?? splicedFor(symbol)?.components.get(symbol.name);
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

    const here: SplicedPackage = { components: new Map(), contexts: new Map() };
    const byId = new Map<string, ComponentNode>();

    for (const node of fragment.graph.nodes) {
      if (node.kind === "component" || node.kind === "hook") {
        const at = splitWhere(node.at);
        const made: ComponentNode = {
          id: node.id,
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
          renders: new Set(),
          mounts: [],
          slotHoles: [],
          slots: node.slots ?? [],
          exported: node.exported === true,
          uses: new Set(),
          opaque: false,
          usesChildren: true,
        };
        byId.set(node.id, made);
        splicedNodes.push(made);
        if (made.exported) here.components.set(made.name, made);
      } else if (node.kind === "context") {
        const fact: ContextFact = {
          id: node.id,
          graphId: node.id,
          at: node.at,
          provider: node.provider,
          consumer: node.consumer,
          label: node.label ?? node.name ?? "context",
          optional: node.optional === true,
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
        from.renders.add(target);
        from.mounts.push({ target, binds });
      } else if (each.kind === "provides" && each.to) {
        from.provides.add(each.to);
      } else if (each.kind === "consumes" && each.to) {
        const at = splitWhere(each.at);
        if (!from.consumes.has(each.to)) from.consumes.set(each.to, { line: at.line, column: at.column });
      } else if (each.kind === "uses" && target) {
        from.uses.add(target);
      } else if (each.kind === "unresolved" && each.via === "slot" && each.slot) {
        from.slotHoles.push({ slot: each.slot });
      }
      // Every edge of the fragment is carried into the app's graph as written, so a report can name
      // the real path THROUGH the package rather than stopping at its surface.
      edges.push(each);
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
    return `\`${text}\` resolves to ${ts.SyntaxKind[declaration.kind]}, not to a component class`;
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
            unresolvedEdge(self.id, "use", node, whyUnresolved(named, "the hook"));
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
              unresolvedEdge(self.id, "use", node, whyUnresolved(named, "the hook"));
            }
          }
        }
      }

      // list({ as: Row }) — items render where the list sits, so the owner is this component.
      if (ts.isCallExpression(node) && calleeName(node) === "list") {
        for (const { target, site } of componentsInListOptions(node)) {
          if (target) {
            mount(self, target, "as", site);
          } else {
            unresolvedEdge(self.id, "as", site, whyUnresolved(site, "the list's `as`"));
          }
        }
      }

      // <RouteOutlet routes={routes} /> — the views mount under the OUTLET, not under the
      // component that renders it. The distinction matters: the outlet is what publishes the
      // matched params, so hanging the views off this component would step over that provider.
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const views = routeViewsOf(node);
        if (views.length > 0) {
          const outlet = componentAt(node.tagName) ?? self;
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
        } else {
          unresolvedEdge(owner.id, via, opening, whyUnresolved(opening.tagName, "the tag"));
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
    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      for (const node of components.values()) {
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
  }

  // ── the walk ────────────────────────────────────────────────────────────────────────────────

  function walk(): ContextIssue[] {
    const issues: ContextIssue[] = [];
    const seen = new Set<string>();

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
      onPath: Set<ComponentNode>,
      bound: Map<string, ComponentNode[]>,
    ): void {
      if (onPath.has(node)) return; // a cycle: it adds no new ancestry

      const here = new Set(provided);
      for (const id of node.provides) here.add(id);
      const nextPath = [...path, node.name];

      for (const [contextId, where] of node.consumes) {
        if (here.has(contextId)) continue;
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

      // An opaque class may provide anything, so stop judging below it.
      if (node.opaque) return;

      const nextOnPath = new Set(onPath).add(node);
      for (const site of node.mounts) visit(site.target, here, nextPath, nextOnPath, site.binds);
      // A tag naming a prop mounts whatever this caller handed over. With nothing bound the hole
      // stays a hole: the analyzer says nothing rather than guessing, which is what makes a report
      // here safe to fail a build on.
      for (const hole of node.slotHoles) {
        for (const filled of bound.get(hole.slot) ?? []) visit(filled, here, nextPath, nextOnPath, new Map());
      }
    }
  }

  // ── small helpers ───────────────────────────────────────────────────────────────────────────

  function resolve(id: ts.Node): ts.Symbol | undefined {
    let symbol = checker.getSymbolAtLocation(id);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol;
  }

  function bindingSymbol(element: ts.ArrayBindingElement | undefined): ts.Symbol | undefined {
    if (!element || !ts.isBindingElement(element) || !ts.isIdentifier(element.name)) return undefined;
    return checker.getSymbolAtLocation(element.name);
  }

  /** Each site keeps its own node, so an `as` that names nothing is a recorded hole. */
  function componentsInListOptions(call: ts.CallExpression): Reference[] {
    const options = call.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return [];
    const found: Reference[] = [];
    for (const prop of options.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
      if (prop.name.text !== "as") continue;
      found.push({ target: componentAt(prop.initializer), site: prop.initializer });
    }
    return found;
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
    return declared ? components.get(declared) : undefined;
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
      const behind = initializerBehind(expression);
      if (behind && behind !== expression) {
        dig(behind, path, depth);
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
    const seen = new Set<ts.Node>();

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
        if (!declaration || seen.has(declaration)) return;
        seen.add(declaration);
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

  /** Why a loader named nothing, said where a reader can act on it. */
  function whyLazyUnresolved(site: ts.Node): string {
    if (ts.isStringLiteralLike(site)) return `\`${site.text}\` exports no component under the name this asks for`;
    return 'the loader has no `import("…")` with a literal specifier, so nothing can name what it loads';
  }

  function routeViewsOf(opening: ts.JsxSelfClosingElement | ts.JsxOpeningElement): Reference[] {
    if (opening.tagName.getText() !== "RouteOutlet") return [];
    for (const attr of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "routes") continue;
      const value = attr.initializer;
      if (!value || !ts.isJsxExpression(value) || !value.expression) continue;
      if (!ts.isIdentifier(value.expression)) continue;
      const symbol = resolve(value.expression);
      const views = symbol ? routeTables.get(symbol) : undefined;
      if (views) return views.map((site) => ({ target: componentAt(site), site }));
    }
    return [];
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
    for (const file of [...sources].sort((a, b) => a.fileName.localeCompare(b.fileName))) {
      hash.update(pathOf(file.fileName));
      hash.update(file.text);
    }

    // The package the project SITS IN, so it matches the prefix every id carries. A fixture with
    // no package.json of its own belongs to the package above it, and saying otherwise would give
    // the graph two names for one thing.
    const home = owner(projectRoot);
    const scope = rootNodes.length > 0 ? "app" : "library";

    return {
      schema: 1,
      // A library has no root, so "unreachable" and "no provider above" cannot be decided in it at
      // all — its graph is a fragment for an app to splice in, not a verdict.
      scope,
      package: home ? { name: home.name, version: packageOf(home.root).version } : packageOf(projectRoot),
      hash: `sha256:${hash.digest("hex")}`,
      ...(scope === "library" && home ? describedFile(home.root) : {}),
      nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
      // Sorted so two runs over the same sources produce the same bytes, and a diff between two
      // commits is the change rather than the traversal order.
      edges: edges.sort((a, b) => `${a.from}${a.at}${a.to ?? ""}`.localeCompare(`${b.from}${b.at}${b.to ?? ""}`)),
    };
  }

  /**
   * Function literals held in fields, on a class this analyzer already calls a component.
   *
   * Deliberately narrow: an arrow or a `function` written IN the field. A field initialised from a
   * call — `debounce(this.save, 200)`, `memoize(fn)` — is left alone, because a wrapper has nowhere
   * else to live and the value is a function only after the call has run.
   */
  function readDuplicateDecorators(cls: ts.ClassDeclaration, owner: string): void {
    /**
     * The two classes of fault are counted at two different LEVELS, and getting that wrong is not a
     * near miss — it is a false positive on ordinary code.
     *
     * A `displacing` decorator answers a question the CLASS asks ("who handles an error from below?"),
     * so two anywhere in the body is the fault. A `redundant` one is about one MEMBER: five fields each
     * carrying `@state` is what every component looks like, and counting `@state` per class reported
     * `<Search> declares @state 5 times` — measured, against this repository's own documentation app,
     * which is how the mistake surfaced.
     */
    const perClass = new Map<string, { count: number; at: ts.Node; kind: "class" | "member" }>();
    const perMember = new Map<string, { count: number; at: ts.Node; member: string }>();

    const count = (node: ts.Node, kind: "class" | "member", member?: string): void => {
      for (const decorator of ts.getDecorators(node as ts.HasDecorators) ?? []) {
        const name = decoratorName(decorator);
        if (name === undefined) continue;

        if (REFUSING.has(name) || DISPLACING.has(name) || MERGING.has(name)) {
          const previous = perClass.get(name);
          if (previous) previous.count += 1;
          else perClass.set(name, { count: 1, at: decorator, kind });
          continue;
        }

        if (REDUNDANT_TWICE.has(name) && member !== undefined) {
          const key = `${member} ${name}`;
          const previous = perMember.get(key);
          if (previous) previous.count += 1;
          else perMember.set(key, { count: 1, at: decorator, member });
        }
      }
    };

    count(cls, "class");
    for (const member of cls.members) count(member, "member", member.name?.getText());

    for (const [decorator, { count: times, at, kind }] of perClass) {
      if (times < 2) continue;
      const effect = REFUSING.has(decorator) ? "refuses" : MERGING.has(decorator) ? "merges" : "displaces";
      duplicateDecorators.push({
        component: owner,
        decorator,
        count: times,
        kind,
        effect,
        ...positionOf(at),
      });
    }

    for (const [key, { count: times, at, member }] of perMember) {
      if (times < 2) continue;
      duplicateDecorators.push({
        component: owner,
        decorator: key.split(" ")[1],
        count: times,
        kind: "member",
        effect: "redundant",
        member,
        ...positionOf(at),
      });
    }
  }

  /**
   * A form field read by a component that does not watch it — see `UnwatchedFieldIssue`.
   *
   * The shape looked for is a property chain that starts at `this.props`, passes through `$`, and ends
   * at a member whose answer moves. Two passes, because the `use` may be written below the read:
   * the first asks whether this class watches anything and which locals hold a field it was handed, the
   * second looks for the reads.
   *
   * **The hook is matched by NAME rather than resolved to `@ramonda/form`.** Resolving it would be
   * stricter, and it would also make the check silent for a re-export — an app's own
   * `export { Field } from "@ramonda/form"`, or a wrapper hook named `Field` that uses it. A local class
   * of that name is the cost, and the direction of the mistake is what settles it: a false negative here
   * is the silent never-re-renders bug shipping, and a false positive is a line of advice about a name
   * somebody chose.
   */
  function readUnwatchedFields(cls: ts.ClassDeclaration, owner: string): void {
    let watches = false;
    /** Locals holding a handle the component was handed — `const f = this.props.of.$`. */
    const held = new Set<string>();

    ts.forEachChild(cls, function first(node) {
      if (ts.isCallExpression(node) && isThisUse(node)) {
        const arg = node.arguments[0];
        const named = arg === undefined ? undefined : hookNamed(arg);
        if (named !== undefined && ts.isIdentifier(named) && named.text === WATCH_HOOK) watches = true;
      }

      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        handedOver(node.initializer)
      ) {
        held.add(node.name.text);
      }

      ts.forEachChild(node, first);
    });

    if (watches) return;

    // One report per component: every read has the same cause and the same fix, and a component showing
    // a field reads three or four of them — `value`, `error`, `bind`. A list of them would say one thing
    // four times and bury the next component.
    let reported = false;

    ts.forEachChild(cls, function second(node) {
      if (reported) return;

      if (ts.isPropertyAccessExpression(node) && FIELD_READS.has(node.name.text)) {
        const from = node.expression;
        const throughProps = ts.isPropertyAccessExpression(from) && from.name.text === "$" && rootedInProps(from);
        const throughLocal = ts.isIdentifier(from) && held.has(from.text);

        if (throughProps || throughLocal) {
          unwatchedFields.push({ component: owner, member: node.name.text, ...positionOf(node) });
          reported = true;
          return;
        }
      }

      ts.forEachChild(node, second);
    });
  }

  /** Whether an expression is a `$` reached from `this.props` — the handle of a field handed over. */
  function handedOver(node: ts.Expression): boolean {
    return ts.isPropertyAccessExpression(node) && node.name.text === "$" && rootedInProps(node);
  }

  /**
   * Whether a property chain starts at `this.props`.
   *
   * Element access is walked too, so `this.props.rows[0].v.$` is seen for what it is.
   */
  function rootedInProps(node: ts.Node): boolean {
    let at: ts.Node = node;
    while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) {
      if (
        ts.isPropertyAccessExpression(at) &&
        at.name.text === "props" &&
        at.expression.kind === ts.SyntaxKind.ThisKeyword
      ) {
        return true;
      }
      at = at.expression;
    }
    return false;
  }

  function readArrowFields(cls: ts.ClassDeclaration, owner: string): void {
    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member) || !member.initializer) continue;
      // `static` is not an instance member: it exists once per class, so there is no closure per
      // instance to save and nothing for method binding to have done. A static arrow is a plain
      // constant that happens to be callable.
      if (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) continue;
      const value = member.initializer;
      if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) continue;

      let readsThis = false;
      const look = (n: ts.Node): void => {
        if (n.kind === ts.SyntaxKind.ThisKeyword) readsThis = true;
        // A nested class or a `function` re-binds `this`, so what is inside one says nothing
        // about whether THIS field needs the instance.
        if (ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isFunctionDeclaration(n)) return;
        if (!readsThis) ts.forEachChild(n, look);
      };
      ts.forEachChild(value, look);

      arrowFields.push({
        component: owner,
        field: member.name.getText(),
        ...positionOf(member.name),
        readsThis,
      });
    }
  }

  function positionOf(node: ts.Node): {
    file: string;
    line: number;
    column: number;
  } {
    const file = node.getSourceFile();
    const { line, character } = file.getLineAndCharacterOfPosition(node.getStart());
    return { file: file.fileName, line: line + 1, column: character + 1 };
  }
}

// ── module-level helpers (no checker needed) ──────────────────────────────────────────────────

function calleeName(call: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return undefined;
}

function isThisUse(call: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
    call.expression.name.text === "use"
  );
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
