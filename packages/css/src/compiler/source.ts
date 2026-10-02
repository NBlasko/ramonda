import { CssBlockError } from "./errors";
import type { Config } from "../config";
import { type Imported, namedSites, syntaxesIn } from "./references";
import { readBlock } from "./read";
import { type Finding, checkBlock, checkNamedSite, checkSite, checkTemplates, checkText } from "./rules";
import { type Ignored, ignoredIn, isIgnored } from "./ignore";
import { findBlocks } from "./scan";
import { type RegisteredSite, type VariableRead, type Variables, variablesIn } from "./variables";

/**
 * Everything the CSS rules say about one FILE's blocks.
 *
 * There is one of this for the same reason there is one `transform`: the sequence is not obvious and
 * every part of it is load-bearing. Finding the sites, resolving a reference to a named site so it
 * reads as the name it compiles to rather than as a hole, asking the TEXT as well as the parse
 * because one of them has no name for a `//`, and passing the references on so a variable set by one
 * name and read by another can be told apart. Written out a second time, any one of those is a place
 * for two answers to the same question.
 *
 * **It was written out twice before this existed** — in `ramonda-check` and, differently, in the
 * documentation gate, which called the framework's checker and no CSS rule at all. So a doc example
 * could carry a CSS fault and pass: measured, `background: var(--ackcent)` beside `--accent: …` was
 * clean to the gate. That was survivable while a build compiled such a block anyway; it stopped being
 * survivable the moment the build began refusing them, because the gate would then be publishing
 * examples that break a reader's build.
 *
 * A block the PARSER refuses is a different thing and is not caught here — it throws, and the caller
 * decides whether that is a refusal to report or a file to skip.
 */
export interface SourceOptions {
  /** How to read a module a block imports a named site from — see {@link Imported}. */
  readonly read?: Imported["read"];
  /** The project's own settings, from `ramonda.css.ts`. */
  readonly config?: Config;
  /**
   * Read a half-written block instead of refusing it — for an EDITOR, which sees nothing else.
   *
   * The build path is strict: a block the parser refuses has already been reported as a refusal and
   * the run has stopped. An editor is the only place `hole-out-of-place` and its neighbours can fire
   * at all, because by the time a build has spoken there is nothing left to squiggle.
   *
   * **A parameter, because the plugin used to keep its own copy of this whole sequence** — and that
   * copy did not gain the site rules added to this one, so a misspelt `@@name( … )` was reported by
   * `ramonda-css check` and by the build, and not by the editor. Third copy of one question.
   */
  readonly tolerant?: boolean;
}

export function checkSource(source: string, fileName: string, options: SourceOptions = {}): Finding[] {
  return checkedSource(source, fileName, options).findings;
}

/**
 * The same walk, with what the file does with CUSTOM PROPERTIES kept.
 *
 * A `var()` reading a name nothing sets is answerable only when every file is in — see
 * `Sheet.verifyVariables` — so the caller that has every file collects this and asks at the end.
 * Returned from the walk that already parses each block rather than parsed again: `check.ts` reads
 * a file twice as it is, and a third pass for two arrays would be paid on every styled file.
 */
export function checkedSource(
  source: string,
  fileName: string,
  options: SourceOptions = {},
): {
  findings: Finding[];
  variables: Variables;
  /** The custom properties a BLOCK sets, without the registrations — see the return below. */
  blockSets: readonly string[];
  registered: readonly RegisteredSite[];
  ignored: readonly Ignored[];
} {
  const { read, config, tolerant } = options;
  const out: Finding[] = [];
  /** What a BLOCK declares, which is the half that answers whether anything ever sets a name. */
  const blockSets: string[] = [];
  const reads: VariableRead[] = [];
  const readsRegistered: string[] = [];
  /** Every `@@property( … )` this file declares — see {@link RegisteredSite}. */
  const registered: RegisteredSite[] = [];
  // The same reader the build uses, or none — and none means a cross-module reference stays a hole,
  // which `hole-as-a-variable-name` reports. A checker that resolved less than the build would call
  // a working theme a fault; one that resolved more would miss one. Both consumers pass the same.
  const references = namedSites(source, { filename: fileName, read });
  // What each registered property may HOLD, beside what it is called — see `syntaxesIn`.
  const syntaxes = syntaxesIn(source, { filename: fileName, read });

  /**
   * A block inside a `${ … }` is found by nothing below, because a template literal is text — see
   * `checkTemplates`. Asked of the whole FILE, before the sites, since there is no site to hang it on.
   *
   * **Kept OUT of what a directive can silence**, and that is the one place this list differs from
   * the rest. Every other rule here is one a person may take responsibility for; this one is not,
   * because nothing rewrites a block in a template and it reaches the bundler as `@@(` — so the
   * build refuses it whatever a comment says. A directive that quieted the checker and not the build
   * would leave an author with a green editor, a green `ramonda-css`, and a failing build, which is
   * the one direction this package cannot afford.
   */
  const unsilenceable = checkTemplates(source);

  /** What the build would refuse, found by an editor's forgiving read — see the loop below. */
  const refused: Finding[] = [];

  for (const site of findBlocks(source)) {
    const read = readBlock(source, site.open, fileName, { tolerant, resolve: (name) => references.get(name) });
    /**
     * A forgiving read still asks the STRICT one, so the editor says what the build will.
     *
     * An editor reads a half-typed block without refusing it, which is what keeps completion alive —
     * and which also let a block the build refuses outright come back clean: \`else\` first in a
     * block, \`when $(a) $(b)\`, a condition inside a match arm. The sentence is the reader's own, so
     * the two cannot drift; where a rule already names the fault at that spot, the rule says it.
     */
    if (tolerant) {
      try {
        readBlock(source, site.open, fileName, { resolve: (name) => references.get(name) });
      } catch (error) {
        if (!(error instanceof CssBlockError) || error.offset === undefined) throw error;
        refused.push({ rule: "block-refused", at: error.offset, length: 1, message: error.reason ?? error.message });
      }
    }
    /**
     * A site whose NAME is not one this compiles gets that one finding and no more.
     *
     * There is no shape to check the body against, so anything said about it is a guess — and the
     * guess was `rule-out-of-place`, which read `from { … }` as the selector `& from` and reported
     * a nested rule. A wrong message is worse than none: it sends a person to the wrong line.
     */
    /**
     * **Through `rules` too, the way the build reads them.**
     *
     * `checkBlock` below is handed the config and drops what a project switched off; the site check
     * never was, in either door. The build learned to filter these and this one did not, which left
     * `ramonda-css` and an editor reporting a rule the build had been told to let through — two
     * tools disagreeing about one fault, which is the thing the refusal's own note says cannot
     * happen.
     */
    /**
     * **The SITE as well as the named site**, which this door did not ask about.
     *
     * `transform` runs `checkSite` beside `checkNamedSite` — a bare JSX attribute is no longer a
     * spelling it compiles, and it refuses one. This flow called every other checker the build does
     * and not that one, so a bare attribute was a build failure and a clean run of `ramonda-css`,
     * which is the tool a project's CI asks. The editor reports it through a path of its own, so the
     * only quiet tool was the one that gates a pipeline.
     */
    const named = [...checkSite(source, site), ...checkNamedSite(site)].filter(
      (one) => config?.rules?.[one.rule] !== "off",
    );
    out.push(
      ...named,
      ...(named.length > 0
        ? []
        : [
            ...checkText(source, site.open, read.end),
            ...checkBlock(read.block, { at: site.at, references, syntaxes, config }),
          ]),
    );

    // A named site sets nothing on an element; a `@@property` registers a name, and the name it
    // registers is what a reference to it resolves to — so both are counted where the build counts
    // them. See `transform`.
    if (site.at === undefined) {
      const found = variablesIn(read.block);
      blockSets.push(...found.set);
      reads.push(...found.read);
      readsRegistered.push(...(found.readsRegistered ?? []));
    } else if (site.at === "property" && site.name !== "") {
      const name = references.get(site.name);
      if (name !== undefined) {
        registered.push({ name, binding: site.name, at: site.opening, length: site.open - site.opening });
      }
    }
  }

  /**
   * What the author took responsibility for, taken out — and RETURNED, so a run can print it.
   *
   * Every rule here fails a build and nothing could stop one, which is only bearable while no rule
   * is ever wrong. See {@link ignoredIn}: line scoped, an empty reason refused, and every annotated
   * site handed back rather than swallowed.
   */
  const { ignored, findings } = ignoredIn(source);
  /**
   * A refusal is said once: not where a rule already reports that very character. And never
   * silenced — the build refuses whatever a comment or a config says, so an editor that went quiet
   * would promise a build that cannot happen.
   */
  const named = refused.filter(
    (one) => !out.some((other) => other.at <= one.at && one.at < other.at + Math.max(other.length, 1)),
  );
  return {
    findings: [
      ...findings,
      ...unsilenceable,
      ...named,
      ...out.filter((finding) => !isIgnored(source, ignored, finding)),
    ],
    /**
     * A registration counts as SETTING the name, because it carries an initial value and so always
     * resolves — that is what `Sheet.unknownVariables` asks. It is composed here rather than pushed
     * as it is found, so `blockSets` keeps the other answer: whether anything ever assigns one.
     */
    variables: { set: [...blockSets, ...registered.map((one) => one.name)], read: reads, readsRegistered },
    blockSets,
    registered,
    ignored,
  };
}
