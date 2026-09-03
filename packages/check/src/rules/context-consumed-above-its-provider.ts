import ts from "typescript";
import { hookNamed, isThisUse, positionOf } from "../syntax";
import { type ContextHalf, contextHalfOf } from "./context-pair";
import { heritage } from "./render-reach";
import type { Rule } from "./rule";

/**
 * A context consumed on a line ABOVE the Provider that publishes it on the same component.
 *
 * A component publishes a context on its own object, and a consumer resolves its channel ONCE, in
 * its constructor. Hooks are constructed in field-declaration order — so a consumer written above
 * the provider looked before the provider existed, and reads the nearest provider on an ANCESTOR
 * instead, or the context's default if there is none.
 *
 * ```tsx
 * before = this.use(ThemeConsumer);                     // the ancestor's value
 * own    = this.use(ThemeProvider, () => ({ … }));
 * ```
 *
 * Two field declarations decide what the page shows, and swapping them is the kind of edit a
 * formatter, a merge or a tidy-up makes without anyone reading it as a change.
 *
 * **Only this order.** The other one — provider first, then consumer — is `this.use(QueryClientProvider)`
 * followed by `this.use(Query, …)`: mount a client, then query on it, which is the arrangement
 * `@ramonda/query` and `@ramonda/router` are built around. Reporting it was measured at **14 hits
 * across query's own tests**, every one on the documented pattern.
 *
 * **What this rule can see that RMD057 cannot, and the other way round.** This speaks before anything
 * runs, including for a component down a branch nobody has opened. It only sees a pair written
 * DIRECTLY — `const [P, C] = createContext(…)` and both halves handed to `this.use` in the same
 * class — because that is what it can prove; a provider wrapped in a hook of its own, the way
 * `QueryClientProvider` wraps one, is invisible here and is exactly what the runtime diagnostic
 * catches.
 *
 * **A BASE CLASS is part of the order, and it was missed.** A base's fields initialise before the
 * subclass's, on the same instance, so a consumer inherited from a base is ALWAYS above a provider
 * mounted here — measured against core, which reports `RMD057` for that pair while this rule said
 * nothing. Where two halves come from different classes the chain decides the order; where they are
 * written in one class the source position does, as it always did.
 */
export interface ContextConsumedAboveItsProviderIssue {
  /** The class holding both halves. */
  component: string;
  /** The context's label when it has one, else the consumer binding's name. */
  context: string;
  /** The binding name as this class wrote it, so a reader can find the line. */
  consumer: string;
  /** The provider binding's name, and the line it is declared on. */
  provider: string;
  providerAtLine: number;
  /** The base class the provider is mounted on, or `undefined` when both halves are written here. */
  providerOn: string | undefined;
  /** The CONSUMER's position — the line that reads the value the author did not expect. */
  file: string;
  line: number;
  column: number;
}

export const contextConsumedAboveItsProvider = {
  id: "context-consumed-above-its-provider",

  report: {
    // A warning, and for once not only because the repository starts every rule as one. The
    // arrangement has a legitimate reading — read the outer value and provide a derived one, which
    // works ONLY in this order — as well as a mistake, and nothing static can tell them apart. So it
    // says what it found rather than failing the build over it.
    severity: "error",
    reportedWhen:
      "a component consumes a context on a line above the Provider that publishes it, so the consumer reads an ancestor's value",
    alsoReportedAs: "RMD057",
    heading: (found) => `${found.length} context(s) consumed above the provider on the same component:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> — \`${issue.consumer}\` resolves before \`${issue.provider}\`${
        issue.providerOn === undefined ? "" : ` on <${issue.providerOn}>`
      }, which on line`,
      `    ${issue.providerAtLine} publishes "${issue.context}", so it reads an ancestor's value.`,
    ],
    advice:
      "A consumer resolves its channel ONCE, when it is constructed, and hooks are constructed in\n" +
      "field-declaration order. So a consumer above the provider on its own component looked before\n" +
      "that provider existed, and reads the nearest one on an ANCESTOR instead — or the context's\n" +
      "default, if there is none.\n\n" +
      "If this component's own value was meant, read it through the PROVIDER hook rather than a\n" +
      "consumer: a Provider reads as well as provides, so `this.theme.color` where `theme` is the\n" +
      "Provider always means this component's value and does not depend on the order. Moving the\n" +
      "provider above the consumer works too, and leaves the answer resting on which line is first.\n\n" +
      "If the value from ABOVE was meant — reading the outer theme to derive an inner one — then this\n" +
      "is that arrangement working, and the order it needs is the order it has. Nothing else in the\n" +
      "source says which of the two it is, which is why this is reported rather than failed.\n\n" +
      "The other order is not reported: `this.use(QueryClientProvider)` followed by\n" +
      "`this.use(Query, …)` is mount-a-client-then-query-on-it, and that is what the packages do.\n\n" +
      "A BASE CLASS is part of the order. Its fields initialise first, so a consumer inherited from a\n" +
      "base is always above a provider mounted here, however the two files are laid out.\n\n",
  },

  read(cls, context) {
    const found: ContextConsumedAboveItsProviderIssue[] = [];

    /** Per context, the first half of each kind this class declares, and the FIELD that declared it. */
    type Declared = ContextHalf & {
      at: ts.PropertyDeclaration;
      rank: number;
      /**
       * Where the `this.use` itself sits, which is what orders TWO halves in ONE field.
       *
       * The field's own start cannot: it is the same node for both, so `pair = { reads:
       * this.use(C), writes: this.use(P) }` compared equal and went unreported. One field is one
       * file by definition, so a source position is meaningful here in a way it is not across the
       * heritage chain — which is what `rank` is for.
       */
      where: number;
      on: string | undefined;
    };
    const seen = new Map<ts.VariableDeclaration, { provider?: Declared; consumer?: Declared }>();

    /**
     * FIELD initializers only, in the order they are CONSTRUCTED — because the order is the whole
     * question. A `this.use` inside a method runs when the method is called, which this cannot place
     * relative to a field, so it is not counted.
     *
     * Furthest ancestor first, then this class, and the position in this walk is what orders two
     * halves — `getStart()` compares nothing meaningful across two files.
     */
    let rank = 0;
    const chain = [...heritage(cls, context.resolve)].reverse();
    for (const declaring of [...chain, cls]) {
      const inherited = declaring === cls ? undefined : (declaring.name?.text ?? "a base class");
      for (const member of declaring.members) {
        rank++;
        if (!ts.isPropertyDeclaration(member) || member.initializer === undefined) continue;

        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node) && isThisUse(node)) {
            const named = node.arguments[0];
            const half = named === undefined ? undefined : contextHalfOf(hookNamed(named), context);
            if (half !== undefined) {
              const entry = seen.get(half.pair) ?? {};
              // The FIRST of each kind. A second provider on one component is its own fault (RMD056),
              // and taking the first here keeps this rule answering only its own question.
              const declared = { ...half, at: member, rank, where: node.getStart(), on: inherited };
              if (half.index === 0) entry.provider ??= declared;
              else entry.consumer ??= declared;
              seen.set(half.pair, entry);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(member.initializer);
      }
    }

    for (const { provider, consumer } of seen.values()) {
      if (provider === undefined || consumer === undefined) continue;
      // Both halves on one component, and the consumer first. The other way round is the arrangement
      // the packages are built around and is deliberately silent. Compared by POSITION in the source
      // rather than by line, so two on one line still have an order.
      if (consumer.rank > provider.rank) continue;
      // Same field: the two `this.use` calls are constructed left to right, so their own positions
      // decide. The field's start is one node for both and settled nothing.
      if (consumer.rank === provider.rank && consumer.where >= provider.where) continue;
      // One half has to be declared HERE. Both on a base is that base's own fault, and its own pass
      // reports it — without this, one pair on a shared base was reported again for every subclass.
      if (consumer.on !== undefined && provider.on !== undefined) continue;
      found.push({
        component: context.self.name,
        context: consumer.label ?? consumer.name,
        consumer: consumer.name,
        provider: provider.name,
        providerAtLine: positionOf(provider.at).line,
        providerOn: provider.on,
        // The CONSUMER's field, not the `this.use` inside it — the field is the line a reader moves.
        ...positionOf(consumer.at),
      });
    }

    return found;
  },
} as const satisfies Rule<ContextConsumedAboveItsProviderIssue>;
