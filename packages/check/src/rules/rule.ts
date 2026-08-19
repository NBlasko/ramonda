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
/**
 * How a rule says what it found.
 *
 * On the rule rather than in the CLI, and that is the point of it. The reporting was fourteen
 * hand-written blocks in `cli.ts`, each with its own heading, its own per-issue line and its own
 * closing paragraph — twenty-odd lines of prose per rule, in a file that knows nothing about the
 * rule. The prose has to live somewhere; beside the rule it explains is the only place where the
 * two can be read together and where changing one makes the other obviously stale.
 *
 * What that buys is that `cli.ts` stops growing. Adding a rule adds a file; it adds no line to the
 * command that prints it, and no clause to the sentence that says everything is fine.
 */
export interface Report<Issue> {
  /**
   * `warn` says so and lets the build through; `error` fails it.
   *
   * A new rule is a warning first and an error in a later version — the repository's rule, and the
   * README's argument: a gate that fails a build on something nobody has seen yet is a gate people
   * switch off. It also decides the stream, so a warning cannot be mistaken for a failure in a log.
   */
  severity: "warn" | "error";

  /**
   * The one-line condition the reference prints, in the rule's own words.
   *
   * Here rather than in the documentation, and that is the whole point of the field. The reference
   * page had two tables of these, typed by hand, and they were nine rows stale the day the rules
   * they describe landed beside them — because nothing connected the two. Now the table is
   * GENERATED from this, so a rule cannot be added without its row and a row cannot describe a rule
   * that no longer works that way.
   *
   * A clause, not a sentence: it is printed after the rule's id in a "reported when" column, so it
   * reads as the completion of that phrase. Plain text — the diagnostic link is {@link
   * alsoReportedAs}, so nothing here has to know what the documentation site is built with.
   */
  reportedWhen: string;

  /**
   * The runtime diagnostic that reports the same fault once the line actually runs.
   *
   * Several rules have one, and the pair is deliberate rather than redundant: the rule speaks
   * before anything runs, including for a branch nobody has opened, and the diagnostic catches what
   * left the rule's reach. Naming the code here lets the reference link the two without a second
   * list to keep in step — and lets the generator refuse a code the diagnostics page does not
   * document.
   */
  alsoReportedAs?: string;

  /** The line that opens the section, given everything this rule found. */
  heading(found: readonly Issue[]): string;

  /** The lines for ONE finding — the place, then what was found there. */
  lines(issue: Issue): string[];

  /** What to do about it, printed once under the list rather than once per finding. */
  advice: string;
}

export interface Rule<Issue> {
  /** Stable name, used in messages and in tests. Kebab-case, like the file. */
  id: string;

  report: Report<Issue>;

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
  report: Report<Issue>;
  needs?: string;
  read(file: ts.SourceFile, context: ModuleContext): Issue[];
}

/** A JSX element as written — self-closing or with children. */
export type JsxElementLike = ts.JsxElement | ts.JsxSelfClosingElement;

/**
 * A rule that reads one JSX ELEMENT.
 *
 * The third family, and the one accessibility needs. `alt` on an `<img>`, `title` on an `<iframe>`,
 * a `tabIndex` that is positive — none of those is a question about a class or about a module. They
 * are questions about a tag, and there are dozens of them, so they get a subject of their own
 * rather than dozens of walks.
 *
 * One walk serves all of them: the analyzer visits each element once, builds the context below
 * once, and hands the pair to every active rule. A rule that walked the tree itself would be the
 * fortieth walk of the same source.
 */
export interface ElementRule<Issue> {
  id: string;
  report: Report<Issue>;
  needs?: string;
  read(element: JsxElementLike, context: ElementContext): Issue[];
}

/**
 * A rule that reads one RENDER as a whole — every element in it, in document order.
 *
 * The fourth family, and the one the other three cannot cover between them. An element rule sees
 * one element and its ancestors, which is enough for "is this `<tr>` inside a table" and not enough
 * for anything about two elements that are not related: two ids that are the same, a heading level
 * that jumps, two of a landmark there may be only one of. Those are questions about a whole
 * markup tree, and nothing here had a subject that size.
 *
 * ## Why it is a family and not three more per-class rules
 *
 * A per-class rule could walk the JSX itself — the walk is not what is shared. What is shared is
 * the hard part: deciding whether two elements are ever really BOTH there. `{open ? <a/> : <b/>}`
 * is two elements in the source and one on the page, and a rule that missed that would report
 * correct markup, which is how a rule earns being switched off. {@link TreeNode.alwaysPresent} is
 * computed once, here, so that no rule in this family can forget it — the same argument that put
 * `spreads` on the element family and `needs` on the class one.
 */
export interface TreeRule<Issue> {
  id: string;
  report: Report<Issue>;
  needs?: string;
  read(tree: TreeContext): Issue[];
}

/** One element inside a render, as a tree rule reads it. */
export interface TreeNode extends ElementContext {
  /** The element itself, for a report that has to point at it. */
  element: JsxElementLike;

  /**
   * Whether this element is on the page whenever this render runs.
   *
   * `false` for anything under a `?:`, a `&&`, an `if`, or a callback — a row inside a `map`, a
   * branch of a ternary, the right half of a guard. Those may or may not be there, and a rule that
   * assumed they were would report `{editing ? <input id="x"/> : <span id="x"/>}`, which is one
   * element on the page and correct.
   *
   * A rule about two elements meeting each other may only compare two of these that are `true`.
   * That is the whole reason this family exists, and it is computed here so no rule can forget it.
   */
  alwaysPresent: boolean;
}

/**
 * One render's markup: everything in it, in the order it appears.
 *
 * A "render" is one top-level JSX tree in the source — the thing a `render()` returns, or a helper
 * builds. Deliberately not the COMPOSED tree, which would mean following `<Panel />` into whatever
 * it renders: that depends on props, on state and on what a slot was filled with, and guessing at
 * it is exactly the thing this package refuses to do.
 */
export interface TreeContext {
  /** Every element in this render, in document order. */
  elements: readonly TreeNode[];
}

/**
 * A rule whose subject is the WHOLE PROJECT — every id written in it, and every reference to one.
 *
 * The fifth subject, and the first that none of the other four can approximate. An id is written in
 * one component and referenced in another: `<a href="#pricing">` in a navigation bar, `id="pricing"`
 * on a heading three files away. A per-render rule cannot see the pair, and a per-element rule sees
 * one half of it.
 *
 * ## Why it is a SUBJECT rather than a fifth family of the same kind
 *
 * Every other family reads its subject and answers. This one needs the whole project read BEFORE any
 * rule may speak, because the question is about absence — "nothing anywhere defines this id" — and
 * absence cannot be established from a file that has not been opened yet. So the run does two
 * passes: one that collects, one that asks. That is the structural difference, and it is the reason
 * this could not have been another `TreeRule`.
 *
 * ## What it may and may not claim
 *
 * **Only NEGATIVE existence.** "This id is defined nowhere" is a fact about a project. "This id is
 * defined twice" is not a fault at this scope at all — two pages may each have a `main`, and they
 * are never in one document together. Duplicates belong to `duplicate-id`, whose subject is one
 * render, and that division is deliberate rather than an oversight.
 */
export interface ProjectRule<Issue> {
  id: string;
  report: Report<Issue>;
  needs?: string;
  read(project: ProjectContext): Issue[];
}

/** Where something was written, for a report that has to point at it. */
export interface Where {
  file: string;
  line: number;
  column: number;
}

/** One `id` this analyzer could not read, and therefore could not put in the table. */
export interface UnreadableId extends Where {
  /** The expression as written — `{this.props.id}` — which is what the reader has to find. */
  written: string;
}

/** One place an id is NAMED: a fragment link, an ARIA relationship, a `htmlFor`. */
export interface IdReference extends Where {
  /** The attribute that names it — `href`, `aria-labelledby`, `htmlFor`. */
  attribute: string;
  /** The id named, without the `#` a fragment link carries. */
  target: string;
  /** The tag it was written on, so a report reads like the source. */
  tag: string;
}

/**
 * One form control, as the rule about labels needs to see it.
 *
 * The FACTS are collected here and the judgement is made in the rule, deliberately: what is written
 * on an element and what encloses it are things only the walk can see, while "this control has no
 * accessible name" is a conclusion drawn from those plus the project's `htmlFor` references. Putting
 * the conclusion in the table would make the table answer a question only one rule asks.
 */
export interface FormControl extends Where {
  /** `input`, `select` or `textarea`. */
  tag: string;
  /** An `input`'s `type`, lowercased, when it is written as a literal. */
  type: string | undefined;
  /** Its `id` when written out, which is what a `htmlFor` could name. */
  id: string | undefined;
  /**
   * Whether it writes an `id` this cannot read.
   *
   * Its own silence, and a narrower one than the family's: a control whose id is unreadable cannot
   * be matched against any `htmlFor`, so nothing can be said about THAT control — while the rest of
   * the project is still perfectly answerable.
   */
  opaqueId: boolean;
  /** Whether `aria-label`, `aria-labelledby` or `title` is written at all, in any form. */
  namingAttribute: boolean;
  /**
   * Whether a `placeholder` is written.
   *
   * Carried apart from the naming attributes because it is neither one thing nor the other, and two
   * rules need to tell it apart from both. The name computation really does fall back to it, so a
   * control with one is not nameless — and a placeholder disappears the moment somebody types, so it
   * is not a label either.
   */
  placeholder: boolean;
  /** Whether a `<label>` encloses it in the same render. */
  insideALabel: boolean;
}

/**
 * Every id the project writes, and every place one is named.
 *
 * Built once, before any rule in this family runs.
 */
export interface ProjectContext {
  /** Every id written out in full, anywhere in the project. */
  ids: ReadonlySet<string>;

  /**
   * The literal HEAD of every id built from a template — `row-` from `` id={`row-${i}`} ``.
   *
   * A template can only produce strings that begin with its first literal chunk, so a reference to
   * something that does not begin with any of these cannot be one of them. That is a real proof
   * rather than a heuristic, and it is what keeps a list's generated ids from silencing the whole
   * table the way a fully opaque one does.
   */
  prefixes: readonly string[];

  /**
   * The ids this analyzer could NOT read — `id={this.props.id}`, `id={createId()}`.
   *
   * **One of these silences every rule in this family**, and that is the silence contract taken at
   * its word: an author who writes an id this cannot name has told us their ids are built at
   * runtime, and "this id is defined nowhere" stops being something anybody can prove. The list is
   * carried rather than reduced to a flag so the command can SAY why it went quiet — a silence
   * nobody can see is a silence nobody can fix.
   *
   * **A SPREAD is deliberately not one of these**, and the line is worth defending because it is
   * the one place this family accepts a residual risk. `<input {...bind} />` may carry an `id` and
   * nothing here can say whether it does — but it is not a claim that it does, whereas `id={x}` is.
   * Counting spreads here was measured against this repository and would have silenced every rule
   * in every project in it: four to sixteen spreading elements each, against **zero** explicit
   * unreadable ids. A rule that is off everywhere is not a strict rule, it is an absent one.
   *
   * The risk that leaves is precise, and small: a project whose ONLY definition of some id arrives
   * through a spread, while a reference to it is written out as a literal. Ramonda's own spread
   * carries `name`, the handlers and `aria-invalid` — checked, not assumed — and no `id`. A
   * reference written as a literal is nearly always written beside the literal id it names.
   *
   * An element that spreads is still never asked about its own references: that element's
   * uncertainty is real, and it is the same stance the per-element family takes.
   */
  unreadable: readonly UnreadableId[];

  /** Every place an id is named. */
  references: readonly IdReference[];

  /** Every form control, with what the walk could see about how it might be named. */
  controls: readonly FormControl[];
}

export interface ElementContext {
  /**
   * The tag, lowercased, when this is a host element — `div`, `img`, `iframe`.
   *
   * `undefined` for a COMPONENT (`<Panel />`, `<screens.reader />`). An accessibility rule is about
   * markup, and a component is not markup yet: what `<Panel />` renders is decided inside `Panel`,
   * where this rule will meet it again as the tag it really is.
   */
  tag: string | undefined;

  /** Whether an attribute is written at all, whatever its value. Case-insensitive. */
  has(name: string): boolean;

  /**
   * An attribute's value when it is a plain string literal, and `undefined` otherwise.
   *
   * `undefined` covers two different things on purpose — not written, and written as an expression
   * this cannot read. Both mean the same to a rule that may only report what it can prove.
   */
  attr(name: string): string | undefined;

  /**
   * Whether the element spreads props — `<img {...rest} />`.
   *
   * **The silence contract, in one flag.** A spread may carry the very attribute a rule is about,
   * and nothing here can say whether it does. Every rule in this family has to go quiet on a
   * spreading element, so the runner does it for them: a spreading element is never handed to a
   * rule at all. It is on the context anyway because a rule may want to say something about the
   * spread itself one day, and because a flag nobody can see is a decision nobody can find.
   */
  spreads: boolean;

  /** The element's children, for the rules about what is INSIDE a tag rather than on it. */
  children: readonly ts.JsxChild[];

  /**
   * Whether this element goes into the SVG namespace, which decides whether an attribute NAME
   * survives as written.
   *
   * An HTML element is given its attributes through `setAttribute`, which the HTML specification
   * lowercases — so `aria-labelledBy` arrives as `aria-labelledby` and works. An SVG element is
   * given them through `setAttributeNS(null, name)`, which writes the name verbatim, so the same
   * spelling is a different attribute that nothing reads. Measured through `renderToString`, not
   * assumed: the two halves came out opposite, and a rule that believed the wrong one reported
   * correct markup.
   *
   * On the context rather than in each rule because two already need it and a third will: it is a
   * fact about the element, and working it out per rule is how the two would disagree.
   *
   * By TAG NAME, because that is how the framework decides it — `<circle>` is SVG wherever it is
   * written, and a `<div>` inside a `<foreignObject>` is HTML.
   */
  inSvg: boolean;
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

  /**
   * The symbol as WRITTEN, with an import alias left unfollowed.
   *
   * The other half of the question above, and it is a different question rather than a weaker one.
   * `resolve` answers "what is this?", which is what a rule wants when it is looking for a
   * particular declaration; this answers "how did this file get it?", which is what a rule wants
   * when the import STATEMENT is the evidence.
   *
   * `late-request-read` is why it exists. An app is entitled to its own function called
   * `requestContext`, so that rule cannot go by name — it goes by the module specifier the reader
   * typed, and reaching that means holding the local symbol whose declaration is the
   * `ImportSpecifier`. Followed through the alias, the declaration is in core and says nothing
   * about how this file reached it.
   *
   * Not the default, because every OTHER rule wants the thing an import points at: keeping the two
   * apart is what stops a rule from silently answering the wrong one.
   */
  resolveLocal(id: ts.Node): ts.Symbol | undefined;
}
