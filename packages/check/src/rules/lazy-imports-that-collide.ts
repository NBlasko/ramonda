import type { LazySite, ProjectRule } from "./rule";

/**
 * Two `lazy` functions written the same way, loading different modules.
 *
 * `AsyncLoad`'s module cache is keyed by the SOURCE of the `lazy` it was given — `cacheKeyFor` in
 * `core/base/AsyncLoad.ts` reads `props.lazy.toString()`. That is right for the ordinary case and
 * wrong for one: `() => import("./Panel")` is a single string and a different module in every
 * directory it is written in. Two of those share one cache entry.
 *
 * ## What the runtime does about it, and why a rule is still worth having
 *
 * `RMD049`. The runtime PROVES the collision before reporting — it has both modules loaded and
 * compares them — and then hands the newcomer a minted key so nothing is served the wrong module.
 * So the page is not broken; what it costs is a diagnostic nobody sees until both branches have
 * actually rendered, in a development build, in the same session.
 *
 * This reads it from the source instead, where both sites are visible at once whether or not either
 * has ever been on screen.
 *
 * ## What is NOT reported
 *
 * **The same text in one directory.** It names one module, so there is nothing to tell apart — and
 * the runtime agrees: `claim()` fires only when the two load DIFFERENT things.
 *
 * **A bare specifier.** `import("@acme/panel")` names the same package wherever it is written, so
 * identical text can never be two modules.
 *
 * **An explicit `cacheKey`.** The app's own claim about identity, which the runtime believes and so
 * does this: two entries deliberately given one key are meant to share it.
 *
 * **Any element that spreads.** This is settled by an attribute that is NOT written, and a spread
 * may be carrying it — `<AsyncLoad {...rest} lazy={…} />` where `rest` holds a `cacheKey` is
 * correct code. An absent attribute is not provable past a spread, in either direction.
 *
 * **A specifier that is not a literal.** An import built at runtime is not something this can name.
 *
 * ## Why a warning
 *
 * Nothing renders wrong: the runtime resolves the collision by minting a key. What it costs is a
 * second cache entry for a module that already had one, and a diagnostic that only speaks once both
 * halves have rendered.
 */
export interface LazyImportsThatCollideIssue {
  /** The function's source, which is the key both sites end up under. */
  written: string;
  /** The other site — a report about a PAIR has to name both, or it names half a fault. */
  otherFile: string;
  otherLine: number;
  file: string;
  line: number;
  column: number;
}

export const lazyImportsThatCollide = {
  id: "lazy-imports-that-collide",

  report: {
    severity: "error",
    reportedWhen:
      "two `lazy` functions are written identically but name different modules — the module cache is keyed by the function's source, so one entry has to serve both",
    alsoReportedAs: "RMD049",
    heading: (found) => `${found.length} \`lazy\` function(s) sharing a cache key with another module:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    \`${issue.written}\` is written the same way at ${issue.otherFile}:${issue.otherLine}, and the two load different modules.`,
    ],
    advice:
      "`AsyncLoad` keys its module cache on the SOURCE of the `lazy` it is given, which is right\n" +
      'until two of them are written identically. `() => import("./Panel")` is one string and a\n' +
      "different module in every directory it appears in, so both sites land on one cache entry.\n\n" +
      "The runtime notices and mints a second key, so nothing renders wrong — but it can only\n" +
      "notice once both have actually rendered, in a development build. From the source both are\n" +
      "visible at once.\n\n" +
      "Give one of them a `cacheKey`. It is the app saying which entry it means, and it is believed\n" +
      "by the runtime and by this rule alike.\n\n",
  },

  read({ lazySites }) {
    const found: LazyImportsThatCollideIssue[] = [];
    const bySource = new Map<string, LazySite[]>();
    for (const site of lazySites) {
      if (site.module === undefined) continue;
      const list = bySource.get(site.text) ?? [];
      list.push(site);
      bySource.set(site.text, list);
    }

    for (const sites of bySource.values()) {
      if (sites.length < 2) continue;
      for (const site of sites) {
        // The FIRST site naming a different module, which is the one a reader is sent to. Reported
        // per site rather than once per pair: each is a place somebody has to decide about.
        const other = sites.find((one) => one.module !== site.module);
        if (other === undefined) continue;
        found.push({
          written: site.text.length > 46 ? `${site.text.slice(0, 45)}…` : site.text,
          otherFile: other.file,
          otherLine: other.line,
          file: site.file,
          line: site.line,
          column: site.column,
        });
      }
    }

    return found;
  },
} as const satisfies ProjectRule<LazyImportsThatCollideIssue>;
