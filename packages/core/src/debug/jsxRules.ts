import { renderPhase } from "./renderPhase";
import { diagnose } from "./diagnostics";

/**
 * DEV-only: what is allowed to stand in a JSX tag.
 *
 * A Ramonda tag is always exactly one element — that rule is what lets you read
 * the DOM off the JSX. TypeScript already refuses a function there (see
 * JSX.ElementType in global.ts), so this only fires when types were bypassed or
 * the build has none. It exists so the pattern is enforced at runtime too,
 * rather than a function quietly behaving like a component with no element.
 */

/**
 * Reports a function used where a JSX tag belongs (RMD011). Deduped by the
 * function's name — the same bad tag inside a list would otherwise report once
 * per item.
 */
export function reportFunctionTag(name: string): void {
  const shown = name || "An anonymous function";
  diagnose("RMD011", shown, `${shown} was used as a JSX tag: <${name || "…"} />.`);
}

/**
 * Reports the unkeyed children of an expression-built array (RMD023) —
 * `{items.map((item) => <Row item={item} />)}`.
 *
 * ## Why it is not narrower, when a `.map()` is the thing being caught
 *
 * The first version of this reported every raw array in children position, and it was
 * wrong: a mapped array is a SUPPORTED shape here, not a mistake. It becomes an anonymous
 * region with its own key space (`ChildGroups.test.tsx`), and the diagnostics reference
 * says so — "`<ul><li>Header</li>{items.map(…)}</ul>` is legitimate, and reconciliation
 * handles it". A check that contradicts the framework's own documented behaviour teaches
 * people to ignore diagnostics. Measured before narrowing: 10 of core's own tests failed,
 * every one of them exercising the feature on purpose.
 *
 * What is NOT handled is identity. A region's rows are matched by POSITION unless they
 * carry keys, and position is not identity: insert a row anywhere but the end and every
 * row after it takes the previous row's place.
 *
 * The second version asked for a COMPONENT among them, on the reasoning that plain markup
 * survives being matched by position because the diff patches the text. That is true of the
 * text and false of everything else on the element: an `<input>` in a plain `<li>` holds a
 * caret, a selection and whatever the user typed, and those follow the node. So the shape
 * `checkUnkeyedArrayChildren` reports is what it says — built by an expression, more than one
 * child, and no key on any of them, whatever they are. `list()` is offered as the faster shape
 * rather than the required one; a `key` is what it asks for.
 *
 * ## Why structure rather than comparison
 *
 * RMD020 renders twice and compares, and it cannot see any of this. The mapper is handed
 * to `Array.prototype.map` and never stored anywhere the comparison can reach, and what
 * comes out is a run of freshly built vnodes — which is what ALL JSX looks like.
 *
 * The shape, though, is unmistakable: JSX passes children as separate arguments, so a
 * nested ARRAY among them was built by an expression. `list()` arrives as its own branded
 * descriptor, and `{this.props.children}` is the framework's own array, branded when it
 * was built — which is what keeps this from firing on every component that forwards
 * children.
 */
export function reportUnkeyedArrayChildren(names: string[]): void {
  const owner = renderPhase.component?.constructor.name ?? "A render";
  const shown = [...new Set(names)].join(", ");
  diagnose(
    "RMD023",
    `${owner}:${shown}`,
    `<${owner} /> built ${shown} from an array — a \`.map()\`, a \`filter\`, an array literal — with no \`key\` on them.\n` +
      `Their identity is their POSITION, so inserting or removing anywhere but the end moves every row after it: the state and the DOM stay with the position rather than with the item.`,
  );
}
