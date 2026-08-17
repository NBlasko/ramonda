import type ts from "typescript";

/**
 * A rule that reads ONE class and answers with what it found there.
 *
 * ## Why this shape, and what it is deliberately not
 *
 * The checks behind this interface were five nested functions inside `analyzeProject`, each closing
 * over the accumulator it pushed into and over two guards it wrote by hand. That was fine at five.
 * It is not fine at the number this package is heading for, and the reason is not tidiness: a guard
 * written by hand is a guard a new rule can forget, and the two below are the ones that decide
 * whether a rule is honest.
 *
 * A rule takes a class and returns issues. It does not take the graph, it does not take the type
 * checker, and it cannot see the other rules' findings. That is the boundary that keeps this
 * family cheap: these run inside the pass that already walks every class, and a rule that needed
 * the whole graph would have to run after it — which is what the graph's own checks do, and they
 * are not these.
 *
 * ## What it may NOT do
 *
 * **Guess.** This package reports only what it can prove; anything it cannot resolve makes it go
 * quiet for that path rather than report a maybe. A rule that fires on a suspicion ends that, and
 * the README's argument with it — a gate that cries wolf is a gate somebody switches off.
 *
 * **Ask for a type.** The program is built with `noLib` and `types` overridden, on purpose: the
 * analyzer asks the compiler only where a symbol was DECLARED, never what type anything is, and
 * skipping the whole TypeScript lib is most of what a run would otherwise cost. `resolve` below is
 * that one question and the whole of it — `browser-url` uses "resolves to nothing" to tell the
 * browser's `location` from a local of the same name, which costs no type at all.
 */
export interface Rule<Issue> {
  /** Stable name, used in messages and in tests. Kebab-case, like the file. */
  id: string;

  /**
   * A package the project must import before this rule means anything.
   *
   * `browser-url` is the case it exists for: without a router, `window.location` is the only place
   * the answer lives, so reporting it would be reporting the only thing a reader could have
   * written. The gate is an IMPORT rather than a mounted component, because a kit hides the mount —
   * an app imports `@ramonda/router` in one file, builds `Link` and `Navigator` there, and every
   * component sees those instead.
   *
   * Declared rather than written into the rule body so that it cannot be left out of the next one,
   * and so the registry can answer "which rules is this project even running" without calling any.
   */
  needs?: string;

  /**
   * An id prefix this rule never fires inside.
   *
   * The other side of `needs`, and it has to be said separately: inside `@ramonda/router` itself,
   * reading `location` is not the mistake — it is the job, and `urlUtils.ts` is where it happens.
   * A rule about reaching past an abstraction is always wrong about the code that implements it.
   */
  exempt?: string;

  read(cls: ts.ClassDeclaration, context: RuleContext): Issue[];
}

/** The class being read, as a rule needs to name it. */
export interface RuleSubject {
  /** The component or hook's own name, which is what a report says. */
  name: string;
  /** Its graph id — `package/file#Name` — which is what `exempt` is matched against. */
  id: string;
}

/**
 * A rule that reads one FILE rather than one class.
 *
 * The second family, and it arrived at the sixth rule rather than the sixtieth — which is the
 * argument for having found it now. A question about imports, about module scope, about what the
 * bundler can see, has no class to hang off: `import(path)` in a service module belongs to no
 * component, and asking every class about it would ask the same file once per class it contains.
 *
 * `needs` means what it does on {@link Rule}. There is no `exempt`, because that gate is about the
 * subject a rule is reading and this family's subject is a file — if a package needs excluding, it
 * is not in `sources` to begin with.
 */
export interface ModuleRule<Issue> {
  id: string;
  needs?: string;
  read(file: ts.SourceFile, context: ModuleContext): Issue[];
}

export interface ModuleContext {
  /**
   * Builds an issue, unless the author has already written down why this site is the way it is.
   *
   * Supplied by the analyzer rather than written per rule, for the same reason `needs` and `exempt`
   * are declared rather than coded: a guard every rule needs is a guard a rule can forget. Calling
   * it is also the shorter way to write the rule, which is what keeps it from being skipped.
   *
   * Two annotations count, and they are not the same claim. `ramonda-check-ignore <reason>` is this
   * package's own, and the reason it carries stays visible in every run — an empty one is itself
   * reported, because a silence is not a record. `/* @vite-ignore *\/` is the BUNDLER's marker on
   * the very same construct: a rule whose premise is "nothing tells you when you defeat splitting"
   * has no premise left at a site where the bundler told the author and the author answered.
   */
  unlessAnnotated<Issue>(site: ts.Node, make: () => Issue): Issue | undefined;
}

export interface RuleContext {
  self: RuleSubject;
  /**
   * Where a name was declared, or `undefined` when nothing in the program declares it.
   *
   * The analyzer's only use of the type checker, and it is a question about DECLARATIONS rather
   * than types. `undefined` is the useful answer as often as a symbol is: with no lib loaded, a
   * name the browser owns resolves to nothing, while `const location = …` in the source resolves.
   */
  resolve(id: ts.Node): ts.Symbol | undefined;
}
