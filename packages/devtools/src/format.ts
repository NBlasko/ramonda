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
 * `JSON.stringify`, for a value this panel did not choose and cannot vet.
 *
 * A diagnostic's `data` reaches the `LOGS` tab exactly as the framework passed it, which for
 * `propsStability` is the real prop values — so anything an application can put in a prop arrives
 * here. Three of those defeat a plain `JSON.stringify`, and each one THROWS rather than degrading:
 * a `bigint` ("Do not know how to serialize a BigInt"), a cycle, and a getter that throws when read.
 * Out of this listener that is an uncaught exception, so the row never renders — the panel failing on
 * the report it exists to show. Measured with a `bigint`, which needs no cooperation from anybody:
 * a `bigint` prop is an ordinary thing to write.
 *
 * The replacer handles the first two so the reader still sees the value and the shape — `10n`, and
 * `[circular]` where the loop closes. The `catch` is for the third, where the value cannot be read at
 * all and there is nothing better than the row itself.
 *
 * One pass with the replacer rather than a fast path and a retry: a row is rendered per diagnostic,
 * not per frame, and one behaviour is easier to trust than two.
 */
export const safeJson = (value: unknown): string => {
  const seen = new WeakSet<object>();

  try {
    const json = JSON.stringify(
      value,
      (_key, held) => {
        if (typeof held === "bigint") return `${held}n`;
        if (held !== null && typeof held === "object") {
          if (seen.has(held)) return "[circular]";
          seen.add(held);
        }
        return held;
      },
      2,
    );
    // `undefined` when the value itself is not serializable at the top level — a function, say.
    return json ?? String(value);
  } catch {
    return String(value);
  }
};

/**
 * The path to hand the dev server, from what the engine reported in a stack.
 *
 * A stack under a dev server carries a URL with the origin and often a cache-busting query
 * (`/src/App.tsx?t=1712…`), and Vite's editor endpoint resolves what it is given against the project
 * root — so a leading slash would make it an absolute path and miss. A stack under Node carries a
 * real absolute path, which has to pass through untouched.
 */
export const toServerPath = (file: string): string => {
  if (!/^[a-z]+:\/\//i.test(file)) return file;

  let path = file;
  try {
    path = new URL(file).pathname;
  } catch {
    /* not a URL after all; carry on with what we have */
  }
  const query = path.indexOf("?");
  if (query !== -1) path = path.slice(0, query);
  return path.replace(/^\/+/, "");
};

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

/** A written value, short enough for a toast. */
export const toOneLine = (value: unknown): string => {
  const text = safeStringify(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
};
