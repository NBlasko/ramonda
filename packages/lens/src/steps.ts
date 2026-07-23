/**
 * One hop in a path.
 *
 * A chain records these and does nothing else — no traversal, no copying, no
 * proxies. The whole path is known before a single object is read, which is what
 * lets one walk clone each level at most once, even when a `where` matches
 * several elements of the same array.
 */
export type Step =
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "index"; readonly index: number }
  | { readonly kind: "where"; readonly predicate: Predicate };

/**
 * Stored untyped on purpose. The builder's public signature types the predicate
 * against the element type; from here down the value is genuinely unknown, and
 * the one assertion that bridges the two lives at the call site in `focus.ts`.
 */
export type Predicate = (value: unknown, index: number) => boolean;

export const NO_STEPS: readonly Step[] = [];

/**
 * A path written the way a person would, for diagnostics: `.posts.where(…).tags`.
 *
 * `upTo` is exclusive, so a message can point at the hop that failed rather than
 * at the whole chain.
 */
export function formatPath(steps: readonly Step[], upTo: number = steps.length): string {
  let out = "";
  for (let i = 0; i < upTo; i++) {
    const step = steps[i];
    if (step.kind === "key") out += `.${step.key}`;
    else if (step.kind === "index") out += `[${step.index}]`;
    else out += ".where(…)";
  }
  return out === "" ? "(root)" : out;
}
