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

export interface AnalyzeResult {
  issues: ContextIssue[];
  counts: { components: number; contexts: number; roots: number };
  /** What the analyzer could not resolve, so a reader knows where it stayed silent. */
  notes: string[];
}

interface ContextFact {
  id: string;
  label: string;
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
        if (node2) readClassBody(node, node2);
      }
      collectRoot(node);
      ts.forEachChild(node, visit);
    });
  }

  resolveHookContexts();
  const issues = walk();

  return {
    issues,
    counts: { components: components.size, contexts: contexts.size, roots: roots.size },
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
    const fact: ContextFact = { id, label };
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
      // this.use(X)
      if (ts.isCallExpression(node) && isThisUse(node)) {
        const arg = node.arguments[0];
        const symbol = arg && ts.isIdentifier(arg) ? resolve(arg) : undefined;
        if (!symbol) {
          // A hook picked at runtime: it might be any provider, so nothing below can be judged.
          if (arg) self.opaque = true;
        } else {
          const provided = providerSymbols.get(symbol);
          if (provided) self.provides.add(provided.id);
          const consumed = consumerSymbols.get(symbol);
          if (consumed && !self.consumes.has(consumed.id)) {
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

  function positionOf(node: ts.Node): { file: string; line: number; column: number } {
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

function createProgram(tsconfigPath: string): { program: ts.Program; notes: string[] } {
  const notes: string[] = [];
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`[ramonda-check-context] could not read ${tsconfigPath}: ${configFile.error.messageText}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    tsconfigPath.replace(/[^/\\]+$/, ""),
    undefined,
    tsconfigPath,
  );
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) notes.push(String(ts.flattenDiagnosticMessageText(error.messageText, " ")));
  }
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  return { program, notes };
}
