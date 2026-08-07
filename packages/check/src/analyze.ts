import { dirname } from "node:path";
import ts from "typescript";

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
  /** What the analyzer could not resolve, so a reader knows where it stayed silent. */
  notes: string[];
}

interface ContextFact {
  id: string;
  label: string;
  /**
   * `createContext(…, { optional: true })` — the author declared the default a real answer, so
   * no provider above is a legitimate arrangement. The runtime says nothing about it either
   * (RMD003), and the two must agree: a build that fails on what the app is documented to do
   * is worse than no check at all.
   */
  optional: boolean;
}

interface ComponentNode {
  name: string;
  file: string;
  line: number;
  column: number;
  provides: Set<string>;
  /** context id → where it is consumed. */
  consumes: Map<string, { line: number; column: number }>;
  /** Component names this one can render. */
  renders: Set<string>;
  /** Hooks (or components) this one mounts with `this.use(...)`, by name. */
  uses: Set<string>;
  /**
   * Set when the class does something the analyzer cannot follow (a provider chosen at runtime).
   * Everything below such a node is left alone — it might be providing anything.
   */
  opaque: boolean;
  /** Whether the class ever mentions `children`, which decides if JSX handed to it can mount. */
  usesChildren: boolean;
}

const CORE_ROOTS = new Set(["bootstrap", "hydrateRoot"]);

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

  /** Symbol of a `createRoutes(...)` binding → the component names in its table. */
  const routeTables = new Map<ts.Symbol, Set<string>>();

  const components = new Map<string, ComponentNode>();
  const arrowFields: ArrowFieldIssue[] = [];
  const duplicateDecorators: DuplicateDecoratorIssue[] = [];
  const unwatchedFields: UnwatchedFieldIssue[] = [];
  const classSymbolToName = new Map<ts.Symbol, string>();
  const roots = new Set<string>();
  /** Where a hook was used, so a context it carries is reported at the use site. */
  const useSites = new Map<string, { line: number; column: number }>();

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
        const node2 = components.get(node.name.text);
        if (node2) {
          readClassBody(node, node2);
          readArrowFields(node, node2.name);
          readDuplicateDecorators(node, node2.name);
          readUnwatchedFields(node, node2.name);
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
    const fact: ContextFact = {
      id,
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

    const views = new Set<string>();
    ts.forEachChild(node.initializer, function scan(n) {
      const tag = jsxTagName(n);
      if (tag) views.add(tag);
      ts.forEachChild(n, scan);
    });
    routeTables.set(symbol, views);
  }

  function collectClass(node: ts.Node): void {
    if (!ts.isClassDeclaration(node) || !node.name) return;
    if (!extendsComponentOrHook(node)) return;
    const pos = positionOf(node);
    components.set(node.name.text, {
      name: node.name.text,
      file: pos.file,
      line: pos.line,
      column: pos.column,
      provides: new Set(),
      consumes: new Map(),
      renders: new Set(),
      uses: new Set(),
      opaque: false,
      usesChildren: node.getText().includes("children"),
    });
    const symbol = checker.getSymbolAtLocation(node.name);
    if (symbol) classSymbolToName.set(symbol, node.name.text);
  }

  /** `bootstrap(<App />, el)` / `hydrateRoot(<App />, el)` — where a tree starts. */
  function collectRoot(node: ts.Node): void {
    if (!ts.isCallExpression(node)) return;
    const name = calleeName(node);
    if (!name || !CORE_ROOTS.has(name)) return;
    const tag = node.arguments[0] ? jsxTagName(node.arguments[0]) : undefined;
    if (tag) roots.add(tag);
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
          if (arg) self.opaque = true;
        } else {
          const provided = providerSymbols.get(symbol);
          if (provided) self.provides.add(provided.id);
          const consumed = consumerSymbols.get(symbol);
          if (consumed && !consumed.optional && !self.consumes.has(consumed.id)) {
            self.consumes.set(consumed.id, positionOf(node));
          }
          // A hook can carry a context for its owner — `this.use(Router)` is how the router
          // publishes its own. Whatever that hook provides or consumes, the owner does too.
          const usedClass = classSymbolToName.get(symbol);
          if (usedClass && !provided && !consumed) {
            self.uses.add(usedClass);
            if (!useSites.has(usedClass)) useSites.set(usedClass, positionOf(node));
          }
        }
      }

      // list({ as: Row }) — items render where the list sits, so the owner is this component.
      if (ts.isCallExpression(node) && calleeName(node) === "list") {
        for (const name of componentsInListOptions(node)) self.renders.add(name);
      }

      // <RouteOutlet routes={routes} /> — the views mount under the OUTLET, not under the
      // component that renders it. The distinction matters: the outlet is what publishes the
      // matched params, so hanging the views off this component would step over that provider.
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const views = routeViewsOf(node);
        if (views.length > 0) {
          const outlet = components.get("RouteOutlet");
          for (const name of views) (outlet ?? self).renders.add(name);
        }
      }

      ts.forEachChild(node, visit);
    });

    // JSX ownership needs its own walk, because children of a COMPONENT element belong to that
    // component, not to the class whose render() wrote them.
    ts.forEachChild(cls, (n) => walkJsx(n, self.name));
  }

  /**
   * Attributes and children of `<C>` belong to C (it decides where and whether to render them);
   * everything else belongs to the enclosing component.
   */
  function walkJsx(node: ts.Node, owner: string): void {
    const tag = jsxTagName(node);
    if (tag) {
      const ownerNode = components.get(owner);
      if (ownerNode) ownerNode.renders.add(tag);

      const nested = components.has(tag) ? tag : owner;
      // Only descend into a component's children if it can actually mount them.
      const child = components.get(tag);
      const inner = child && !child.usesChildren ? owner : nested;
      const element = ts.isJsxElement(node) ? node : undefined;
      if (element) for (const c of element.children) walkJsx(c, inner);
      const opening = element ? element.openingElement : (node as ts.JsxSelfClosingElement);
      for (const attr of opening.attributes.properties) walkJsx(attr, nested);
      return;
    }
    ts.forEachChild(node, (n) => walkJsx(n, owner));
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
        for (const usedName of node.uses) {
          const used = components.get(usedName);
          if (!used) continue;
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

    for (const root of roots) {
      visit(root, new Set(), [], new Set());
    }

    return issues;

    function visit(name: string, provided: Set<string>, path: string[], onPath: Set<string>): void {
      if (onPath.has(name)) return; // a cycle: it adds no new ancestry
      const node = components.get(name);
      if (!node) return;

      const here = new Set(provided);
      for (const id of node.provides) here.add(id);
      const nextPath = [...path, name];

      for (const [contextId, where] of node.consumes) {
        if (here.has(contextId)) continue;
        const key = `${contextId}@${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({
          context: contexts.get(contextId)?.label ?? "context",
          consumer: name,
          file: node.file,
          line: where.line,
          column: where.column,
          path: nextPath,
        });
      }

      // An opaque class may provide anything, so stop judging below it.
      if (node.opaque) return;

      const nextOnPath = new Set(onPath).add(name);
      for (const child of node.renders) visit(child, here, nextPath, nextOnPath);
    }
  }

  // ── small helpers ───────────────────────────────────────────────────────────────────────────

  function resolve(id: ts.Identifier): ts.Symbol | undefined {
    let symbol = checker.getSymbolAtLocation(id);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol;
  }

  function bindingSymbol(element: ts.ArrayBindingElement | undefined): ts.Symbol | undefined {
    if (!element || !ts.isBindingElement(element) || !ts.isIdentifier(element.name)) return undefined;
    return checker.getSymbolAtLocation(element.name);
  }

  function componentsInListOptions(call: ts.CallExpression): string[] {
    const options = call.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return [];
    const found: string[] = [];
    for (const prop of options.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
      if (prop.name.text !== "as") continue;
      if (ts.isIdentifier(prop.initializer)) found.push(prop.initializer.text);
    }
    return found;
  }

  function routeViewsOf(opening: ts.JsxSelfClosingElement | ts.JsxOpeningElement): string[] {
    if (opening.tagName.getText() !== "RouteOutlet") return [];
    for (const attr of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "routes") continue;
      const value = attr.initializer;
      if (!value || !ts.isJsxExpression(value) || !value.expression) continue;
      if (!ts.isIdentifier(value.expression)) continue;
      const symbol = resolve(value.expression);
      const views = symbol ? routeTables.get(symbol) : undefined;
      if (views) return [...views];
    }
    return [];
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

/** The component name of a JSX tag, if this node is a JSX element at all. */
function jsxTagName(node: ts.Node): string | undefined {
  const opening = ts.isJsxElement(node)
    ? node.openingElement
    : ts.isJsxSelfClosingElement(node)
      ? node
      : ts.isJsxOpeningElement(node)
        ? node
        : undefined;
  if (!opening) return undefined;
  const name = opening.tagName.getText();
  // Lowercase is an intrinsic element (`div`), which owns nothing.
  return /^[A-Z]/.test(name) ? name : undefined;
}

function extendsComponentOrHook(cls: ts.ClassDeclaration): boolean {
  for (const clause of cls.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const type of clause.types) {
      const name = type.expression.getText();
      if (name === "Component" || name === "Hook" || name.endsWith(".Component") || name.endsWith(".Hook")) {
        return true;
      }
      // A subclass of a subclass still is one; resolved by name in the component map later.
      return true;
    }
  }
  return false;
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
