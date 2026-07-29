/**
 * Escapes for BOTH text and attribute positions, which is why the quotes are in here.
 *
 * They were missing, and it broke the Query tab twice over. A query's hash is JSON, so it
 * carries `"` — and `data-q-hash="["products"]"` ends the attribute at the second quote. The
 * parser then read the rest as bare attributes, so `dataset.qHash` was `[` and both buttons
 * looked up an entry that could not exist: invalidate and remove did nothing, silently. The
 * same broken markup is why the age element could never be found either.
 */
export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * A value as one line, used where a line is all there is room for — a change signature, a
 * summary, a log row. The reader's copy of a value is the tree in `jsonView`, not this.
 *
 * Never throws: a state field can hold a function, a DOM node or something cyclic.
 */
const MAX_VALUE_LEN = 8000;
export const safeStringify = (v: unknown): string => {
  if (typeof v === "function") return "ƒ()";
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    return "[unserializable]";
  }
  return s.length > MAX_VALUE_LEN ? `${s.slice(0, MAX_VALUE_LEN)}…` : s;
};
