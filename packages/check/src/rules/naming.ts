import type { ElementContext } from "./rule";

/**
 * The attributes that give an element an ACCESSIBLE NAME, and the one reader that asks.
 *
 * Four rules had written this list for themselves — `unnamed-image`, `unnamed-frame`,
 * `empty-heading-or-link` and `landmarks-that-cannot-be-told-apart` — three of them under the same
 * name `NAMES_IT` and two of them character for character. A fifth was about to be written for
 * `region-with-no-name`, which is when it was worth stopping: four copies of one question is the
 * shape this package has been bitten by eight times, and every time the fix was the reader.
 *
 * ## Why `alt` is not here
 *
 * It names an IMAGE and only an image, and it is the one naming attribute where EMPTY is a
 * statement rather than an omission: `<img alt="">` is the documented way to say "decoration, skip
 * me". A shared reader that folded `alt` in would either lose that or force the rule about it to
 * argue its way back out, so `unnamed-image` keeps asking about `alt` itself, right beside this.
 *
 * ## An empty one names NOTHING, and that is not true of `alt`
 *
 * `aria-label=""`, `aria-labelledby=""` and `title=""` all give the accessibility tree no name at
 * all — the attribute is there and the element is still anonymous. Read as PRESENCE alone, which is
 * how all four callers read it, an author who wrote a name and left it empty was treated as having
 * named the thing.
 *
 * Only a value this can READ counts against them. `aria-label={t("filters")}` is somebody naming it
 * and whether that string is empty is not a question answerable here — the silence contract, and
 * the same line every other reader in this family draws.
 *
 * **The id table reached this on its own and kept it.** Its note records the measurement:
 * `<input type="text" aria-labelledby="" />` had no name at all and was reported by nothing,
 * "because the attribute that names nothing had answered for the one that would have". It walks raw
 * attributes rather than a context, so it cannot call the reader below — but it reads the same list
 * from here now, and the four rules that only asked `has` have the same answer it does.
 */
export const NAMES_IT: ReadonlySet<string> = new Set(["aria-labelledby", "aria-label", "title"]);

/**
 * Whether anything on this element gives it an accessible name.
 *
 * `also` takes the attributes that name one KIND of element and nothing else — `alt` on an image —
 * and they are asked by PRESENCE, because an empty one of those can be a statement of its own.
 */
export function isNamed({ has, attr }: Pick<ElementContext, "has" | "attr">, also: readonly string[] = []): boolean {
  if (also.some((name) => has(name))) return true;

  for (const name of NAMES_IT) {
    if (!has(name)) continue;
    // Written and readable and empty: the attribute is there and it names nothing.
    if (attr(name)?.trim() !== "") return true;
  }
  return false;
}
