import ts from "typescript";
import { hookNamed, isThisUse, positionOf } from "../syntax";
import { contextHalfOf } from "./context-pair";
import { heritage } from "./render-reach";
import type { Rule } from "./rule";

/**
 * Two Providers of ONE context on one component — which core refuses at runtime (RMD056).
 *
 * A component publishes a context on one object, so the second Provider replaces the first and hands
 * every descendant the second whichever part of the tree it is in, while the component itself can
 * still read both through its own hooks. There is no reading of two the framework could honour, so
 * `createContext`'s Provider throws in every build.
 *
 * **Then why a rule as well.** The throw arrives when the component is CONSTRUCTED, so a component
 * down a branch nobody has opened ships with the fault and takes the page out on the click that
 * finally reaches it. This says it from the source, before anything runs — which is the whole
 * argument for this package, and it is sharper here than for most rules, because the runtime answer
 * is not a warning that can be lived with but a crash.
 *
 * **What it sees, and what it cannot.** Only a pair written directly: `const [P, C] =
 * createContext(…)`, with `P` handed to `this.use` twice in one class, resolved through the
 * `BindingElement` each name came from — so an import alias is transparent and two contexts of the
 * same shape stay two contexts. A Provider wrapped in a hook class of its own, the way
 * `QueryClientProvider` and `Form` wrap theirs, is invisible here; that case is the runtime's.
 *
 * **A BASE CLASS counts, and it was missed.** Field initialisers run base-first on ONE instance, so
 * a component whose base mounts the Provider and which mounts another is one component publishing
 * twice — measured against core, which throws `RMD056` for exactly that pair while this rule said
 * nothing. The chain is walked furthest ancestor first, which is the order the hooks are built in.
 */
export interface OneProviderPerComponentIssue {
  /** The class holding both. */
  component: string;
  /** The context's label when it has one, else the binding's name. */
  context: string;
  /** The binding name as this class wrote it. */
  provider: string;
  /** The line of the FIRST one, so a reader can see both. */
  firstAtLine: number;
  /** The base class the first one is inherited from, or `undefined` when both are written here. */
  firstOn: string | undefined;
  /** The SECOND one's position — the line that throws, and the one to move. */
  file: string;
  line: number;
  column: number;
}

export const oneProviderPerComponent = {
  id: "one-provider-per-component",

  report: {
    // An ERROR rather than the usual warning-first, and the exception is the point: the runtime does
    // not warn about this either, it throws. A warning here would say "this is survivable" about a
    // line that takes the page down the moment it runs.
    severity: "error",
    reportedWhen: "one component mounts two Providers of the same context, which core refuses at runtime",
    alsoReportedAs: "RMD056",
    heading: (found) => `${found.length} component(s) providing one context twice:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> — a second \`${issue.provider}\` for "${issue.context}", after ${
        issue.firstOn === undefined
          ? `line ${issue.firstAtLine}`
          : `the one <${issue.firstOn}> mounts on line ${issue.firstAtLine}`
      }. This throws when the component is constructed.`,
    ],
    advice:
      "A component publishes a context on ONE object, so the second Provider replaces the first and\n" +
      "every descendant reads the second whichever part of the tree it is in — while this component\n" +
      "can still read both through its own hooks, which is what makes it invisible from here.\n\n" +
      "Give each one its own component and the subtree it is for. A component that renders\n" +
      "`this.props.children` scopes its context to what is inside it, so two of them side by side are\n" +
      "two independent scopes and a consumer in each finds its own with nothing passed down:\n\n" +
      "    class Scope extends Component<{ theme: string; children?: RamondaNode }> {\n" +
      "      provider = this.use(ThemeProvider, () => ({ theme: this.props.theme }));\n" +
      "      render() { return this.props.children; }\n" +
      "    }\n\n" +
      "If the two values are for different purposes, they are two contexts — call `createContext`\n" +
      "twice. Splitting the keys between two Providers is not a way out: a Provider takes its options\n" +
      "whole, so the second replaces the channel and the first half falls back to the default.\n\n" +
      "NESTING is untouched. A Provider on a descendant shadows the one above it for its own branch,\n" +
      "which is ordinary — only two on the SAME component are refused.\n\n" +
      "A BASE CLASS is the same component. Its fields initialise first, on the same instance, so a\n" +
      "Provider inherited from a base and another mounted here are two on one object — move one of\n" +
      "them onto a component of its own rather than up or down the chain.",
  },

  read(cls, context) {
    const found: OneProviderPerComponentIssue[] = [];

    /** Per context, the first Provider field this component declares — its bases included. */
    const first = new Map<
      ts.VariableDeclaration,
      { name: string; label?: string; at: ts.PropertyDeclaration; on: string | undefined }
    >();

    /**
     * FIELD initialisers only, in the order they are CONSTRUCTED — because that is what decides
     * which of the two throws. A `this.use` inside a method runs when the method is called, which
     * this cannot place against a field, so it is not counted.
     *
     * Furthest ancestor first, then this class: a subclass's fields initialise after its base's, so
     * a Provider inherited from a base is always the first of the two.
     *
     * The SECOND one has to be declared here, or nothing is reported. Both halves on a base is that
     * base's own fault and its own pass says so — without this, one line on a shared base was
     * reported once for the base and once again for every class extending it.
     */
    const chain = [...heritage(cls, context.resolve)].reverse();
    for (const declaring of [...chain, cls]) {
      const inherited = declaring === cls ? undefined : (declaring.name?.text ?? "a base class");
      for (const member of declaring.members) {
        if (!ts.isPropertyDeclaration(member) || member.initializer === undefined) continue;

        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node) && isThisUse(node)) {
            const named = node.arguments[0];
            const half = named === undefined ? undefined : contextHalfOf(hookNamed(named), context);
            // Index 0 is the Provider. A Consumer twice is harmless — it reads, it publishes nothing.
            if (half !== undefined && half.index === 0) {
              const earlier = first.get(half.pair);
              if (earlier === undefined) {
                first.set(half.pair, {
                  name: half.name,
                  ...(half.label === undefined ? {} : { label: half.label }),
                  at: member,
                  on: inherited,
                });
              } else if (declaring === cls) {
                found.push({
                  component: context.self.name,
                  context: half.label ?? half.name,
                  provider: half.name,
                  firstAtLine: positionOf(earlier.at).line,
                  firstOn: earlier.on,
                  ...positionOf(member),
                });
              }
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(member.initializer);
      }
    }

    return found;
  },
} as const satisfies Rule<OneProviderPerComponentIssue>;
