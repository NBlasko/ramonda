/**
 * The half of the diagnostics protocol that survives a production build.
 *
 * ## Why there are two of these
 *
 * `diagnose()` next door is the whole diagnostic: a title, the prose explaining what to do instead,
 * a console line, and the record. Every call site is wrapped in `if (__DEV__)`, so a production
 * build strips the calls, and with them `SPECS` — which is the largest strippable thing in the
 * package and must stay that way.
 *
 * That leaves production emitting nothing at all, which is right for most of what `diagnose()`
 * catches and wrong for a few. The split is between "what happened", which is machine data and can
 * ship, and "how to fix it", which is prose written for whoever is holding the keyboard.
 *
 * So this module reports the first and knows nothing about the second. It does **not** import
 * `SPECS`, not even to borrow a title, because importing it would put every fix string back into
 * the production bundle — and that bundle is the reason this is a separate module at all. The
 * message a call site passes is a short literal it owns, and the code is what a reader looks up in
 * the reference.
 *
 * ## What is worth reporting from production, and what is not
 *
 * Most diagnostics describe a mistake in code: they fire deterministically, on the first render, on
 * the machine of the person who made it. Shipping those would cost every app bytes to find out
 * something development already said.
 *
 * The ones here are different — they need the world to go wrong, so they cannot be found any other
 * way:
 *
 * - **RMD017**, a deferred hydration that never resumed. The server's markup is still on screen, so
 *   the page looks finished; the subtree has no listeners and answers nothing.
 * - **RMD047**, `@memoizedHandler` with no key. Development throws, which is how it is meant to be
 *   caught — but a build that shipped without being run rebuilds the handler on every render, and
 *   everything it is passed to re-renders with it, for the life of the page.
 *
 * ## It never sends anything
 *
 * There is no network here and there will not be one. The record goes to `__RAMONDA_DIAGNOSTICS__`
 * and nowhere else, so an app with no collector installed behaves exactly as it did before this
 * module existed — that is what makes it opt-in, with no flag to document and no default to argue
 * about. What leaves the process is the app's decision, made in the collector it wrote.
 *
 * Nothing here throws, either. A production diagnostic exists to be noticed later; taking the page
 * down to deliver one would be a worse fault than the one being reported.
 */

/** Bounds the dedup set — a runaway dynamic key cannot grow it without limit. */
const MAX_TRACKED = 1000;

/**
 * Its own set, rather than the one `diagnose()` keeps.
 *
 * Sharing would mean importing that module, which is what this one exists not to do. The cost is a
 * few lines duplicated; the alternative costs every production bundle the whole of `SPECS`.
 *
 * The two sets never disagree in practice because a given call site reports through one of them,
 * never both: development takes the `diagnose()` branch and production takes this one.
 */
const reported = new Set<string>();

/**
 * Reports a fault once per `dedupKey`, to a collector if the app installed one.
 *
 * `message` is the framework's own words about what happened — never a value from the app, because
 * a record may be shipped somewhere and the framework cannot know what is in an app's data. What is
 * safe to send is the app's decision to make in its collector, on a record that carries nothing it
 * did not already have.
 */
export function reportFault(code: string, dedupKey: string, message: string): void {
  const sink = globalThis.__RAMONDA_DIAGNOSTICS__;
  if (sink === undefined) return;

  const id = `${code}:${dedupKey}`;
  if (reported.has(id)) return;
  if (reported.size < MAX_TRACKED) reported.add(id);

  sink({
    code,
    scope: "ramonda/core",
    severity: "error",
    message,
    time: Date.now(),
    dedupKey: id,
  });
}

/** Test-only: lets each test observe a fault a previous one deduped. */
export function resetFaults(): void {
  reported.clear();
}
