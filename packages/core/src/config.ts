/**
 * Development-time switches.
 *
 * A tiny module rather than part of `debug/`, and deliberately so: the flags have to
 * survive into a production build even though everything they gate does not. An app
 * that calls `configureDev(...)` at its entry point must not crash when it is built
 * for production — so the function ships in both builds, and in the production one it
 * simply has nothing left to switch off.
 *
 * The object is a few bytes. The checks it gates are kilobytes, and they are stripped
 * with `__DEV__` as before.
 */
export interface DevFlags {
  /**
   * Whether development builds render each component **twice** and report values
   * that came out different — inline handlers, rebuilt objects, anything that is not
   * a function of state (RMD020).
   *
   * On by default, because the mistakes it names are silent otherwise. Turn it off
   * when a `render()` legitimately has to do something twice-visible — logging while
   * you debug render order, most often — or when a render is heavy enough that
   * doubling it makes development uncomfortable.
   *
   * Turning it off costs only the report. Devtools, the diagnostics and every other
   * DEV check stay exactly as they were.
   */
  strictRender: boolean;
}

/** Read by the checks themselves. Not exported from the package. */
export const devFlags: DevFlags = {
  strictRender: true,
};

/**
 * Changes a development-time switch. **A no-op in a production build**, where the
 * behaviour it controls is not compiled in at all.
 *
 * Call it once, at the app's entry point, before mounting:
 *
 * ```ts
 * import { bootstrap, configureDev } from "@ramonda/core";
 *
 * // Keep the devtools and every diagnostic; stop rendering twice.
 * configureDev({ strictRender: false });
 *
 * bootstrap(<App />, document.querySelector("#app")!);
 * ```
 *
 * Only the keys you pass are changed, so a later flag cannot be reset by accident.
 */
export function configureDev(flags: Partial<DevFlags>): void {
  if (!__DEV__) return;

  if (flags.strictRender !== undefined) devFlags.strictRender = flags.strictRender;
}
