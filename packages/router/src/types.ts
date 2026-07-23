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
  /** true = same page, only query/hash change (synchronous, no route transition). */
  shallow?: boolean;
  /** replaceState instead of pushState (no new history entry). */
  replace?: boolean;
  /** scroll to top after navigating. */
  scroll?: boolean;
}

/** The one language for state changes: a pure function of the freshest state. */
export type StateUpdater = (prev: RouterState) => RouterState;
