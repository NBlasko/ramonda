/**
 * Where a component or hook is DEFINED, so devtools can put you in your editor on it.
 *
 * ## Where the location comes from
 *
 * From the stack of the first construction, and that turned out to need nothing else — no build
 * plugin, no JSX transform, no configuration. A subclass appears in the stack by name even when it
 * declares no constructor of its own, and the frame's position is the class declaration:
 *
 * ```
 *   class NoCtor extends Base { x = 1 }      // line 18
 *   → "at new NoCtor (…/file.mjs:18:1)"
 * ```
 *
 * Measured before building on it, because the whole design rests on it. A class WITH a constructor
 * reports the `super()` line instead, which is inside the same class — near enough that the editor
 * opens where you meant. An inheritance chain reports every link, and the frame matching the
 * instance's own constructor name is the specific one.
 *
 * The alternatives were all worse. A JSX transform would give the CALL SITE (`<Foo />`), not the
 * definition, and esbuild only injects source with the automatic runtime — which this framework
 * does not use. A build plugin would be accurate and would also be a thing every app has to install
 * and configure. A decorator hook would only cover components that happen to have a decorator,
 * which the simplest component does not.
 *
 * ## What it costs
 *
 * One `new Error()` per CLASS, not per instance: the answer is cached on the constructor and a
 * failed lookup is cached too, so a class whose frame cannot be parsed does not retry forever. In a
 * development build only — every call site is inside `if (__DEV__)`.
 *
 * ## The honest limit
 *
 * A stack reports positions in the file the ENGINE loaded, not in your source. A dev server serves
 * a transformed module, and `Error.stack` is not sourcemapped (browsers apply sourcemaps when
 * DISPLAYING a stack in their own devtools, never in the string). esbuild's TSX transform keeps
 * lines aligned in the ordinary case, so the line is usually exact and occasionally a little off.
 * The file is always right, which is most of what "open this component" means. Reading the module's
 * sourcemap to correct it is possible and is not done here.
 */

export interface SourceLocation {
  /** As the engine reported it: an absolute path under Node, a URL under a dev server. */
  file: string;
  line: number;
  column: number;
}

/**
 * `undefined` means "not looked at yet"; `null` means "looked, and the stack did not say" — a
 * distinction that keeps an unparseable class from building a stack on every construction.
 */
const definitions = new WeakMap<object, SourceLocation | null>();

/** `…/file.tsx:18:1`, with the file part allowed to contain colons (a URL scheme does). */
const POSITION = /^(.*):(\d+):(\d+)$/;

/**
 * Pulls the frame for `new <name>` out of a stack, in either of the two shapes engines produce:
 *
 * - V8:               `    at new Foo (http://localhost:3000/src/App.tsx:18:1)`
 * - Firefox / Safari: `Foo@http://localhost:3000/src/App.tsx:18:1`
 */
function frameFor(stack: string, name: string): SourceLocation | null {
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    let position: string | undefined;

    if (line.startsWith(`at new ${name} (`)) {
      position = line.slice(line.indexOf("(") + 1, line.lastIndexOf(")"));
    } else if (line.startsWith(`${name}@`)) {
      position = line.slice(name.length + 1);
    }
    if (position === undefined) continue;

    const found = POSITION.exec(position);
    if (!found) continue;
    return { file: found[1], line: Number(found[2]), column: Number(found[3]) };
  }
  return null;
}

/**
 * Records where an instance's class is defined, once per class.
 *
 * Called from the base `Component` and `Hook` constructors, so it covers every component and hook
 * without either of them opting in — including one with no decorators at all, which is exactly the
 * component a beginner writes and the one a plugin-free approach had to reach.
 */
export function recordDefinition(instance: object): void {
  const ctor = instance.constructor;
  if (definitions.has(ctor)) return;

  const name = ctor.name;
  if (!name) {
    definitions.set(ctor, null);
    return;
  }

  // `Error.captureStackTrace` where it exists (V8): it omits this function's own frame and, more
  // usefully, is not bound by the default stack limit for the frames we skip.
  const holder: { stack?: string } = {};
  const capture = (Error as unknown as { captureStackTrace?: (target: object) => void }).captureStackTrace;
  if (capture) capture(holder);
  else holder.stack = new Error().stack;

  definitions.set(ctor, holder.stack ? frameFor(holder.stack, name) : null);
}

/** What was recorded for a class, or `undefined` if the stack did not say. */
export function definitionOf(ctor: unknown): SourceLocation | undefined {
  if (typeof ctor !== "function") return undefined;
  return definitions.get(ctor) ?? undefined;
}
