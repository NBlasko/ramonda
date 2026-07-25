/** One hash segment, e.g. `#tab=film` → { key: "tab", value: "film", level: 0 }. */
export interface HashTag {
  key: string;
  value: string;
  /** Order of the segment in the URL (0, 1, 2, ...). */
  level: number;
}

/**
 * The whole URL, structured. This is the single source of truth at runtime — the
 * URL is rebuilt from it and synced to history, never read back except at init
 * and on popstate.
 */
export interface RouterState {
  /** window.location.pathname, e.g. "/players/123". */
  baseUrl: string;
  /** Flat ?a=1&b=2 → { a: "1", b: "2" } (single value per key, by design). */
  queryParams: Record<string, string>;
  /** #tab=film#play=5 → ordered segments. */
  hashTags: HashTag[];
}

export interface NavigateOptions {
  /** replaceState instead of pushState (no new history entry). */
  replace?: boolean;
  /**
   * Scroll to the top after navigating. This is the ONE knob left: it is `true`
   * unless a caller asks otherwise, but every caller may. There is no `shallow`:
   * routes match on the PATH only, so a query- or hash-only change never selects
   * a different route — it is inherently a same-page update, with nothing to
   * "skip". The only thing worth choosing there is whether to jump to the top.
   */
  scroll?: boolean;
}

/** The one language for state changes: a pure function of the freshest state. */
export type StateUpdater = (prev: RouterState) => RouterState;

/** Options shared by the partial-state updaters (search params, hash tags). */
export interface PartialNavigateOptions {
  /** replaceState instead of pushState (no new history entry). Default `false`. */
  replace?: boolean;
  /** Scroll to the top afterwards. Default `false` — these are in-place edits. */
  scroll?: boolean;
}

/** New query params, or a pure function of the current ones (race-free). */
export type SearchParamsUpdater = Record<string, string> | ((prev: Record<string, string>) => Record<string, string>);

/** New hash tags, or a pure function of the current ones (race-free). */
export type HashTagsUpdater = HashTag[] | ((prev: HashTag[]) => HashTag[]);
