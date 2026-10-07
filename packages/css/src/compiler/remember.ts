/**
 * A pure function of a property and, where it needs one, a value — answered once per input.
 *
 * A project writes the same declaration again and again — `display: flex`, a border, a margin — and
 * splitting or folding one is the same work every time. Bounded, because a dev server lives for
 * hours: past the limit the table is emptied and refilled, which costs one miss per input.
 *
 * What is remembered is FROZEN, because every caller shares it: one that changed an answer in place
 * would change it for the next file.
 */
export function remember<T>(limit: number, answer: (property: string, value: string) => T) {
  // By property, then by value: a key joined from the two was a new string to hash on every call.
  const known = new Map<string, Map<string, T>>();
  let size = 0;
  // An answer of the property alone takes no value, and whatever else a caller passes — `map` passes
  // the index — is not part of the input.
  const takesValue = answer.length > 1;
  return (property: string, given?: string): T => {
    const value = takesValue ? (given ?? "") : "";
    let values = known.get(property);
    if (values === undefined) known.set(property, (values = new Map()));
    const hit = values.get(value);
    if (hit !== undefined || values.has(value)) return hit as T;
    if (size >= limit) {
      known.clear();
      known.set(property, values);
      values.clear();
      size = 0;
    }
    const found = answer(property, value);
    values.set(value, typeof found === "object" && found !== null ? Object.freeze(found) : found);
    size++;
    return found;
  };
}
