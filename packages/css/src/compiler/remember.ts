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
  const known = new Map<string, T>();
  return (property: string, value = ""): T => {
    // A property name holds no NUL, so every pair has one key.
    const key = value === "" ? property : `${property}\u0000${value}`;
    const hit = known.get(key);
    if (hit !== undefined || known.has(key)) return hit as T;
    if (known.size >= limit) known.clear();
    const found = answer(property, value);
    known.set(key, typeof found === "object" && found !== null ? Object.freeze(found) : found);
    return found;
  };
}
