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
