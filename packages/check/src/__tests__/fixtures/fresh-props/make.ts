/** A helper in ANOTHER FILE that builds a fresh object every call. */
export function makeConf(): { dense: boolean } {
  return { dense: true };
}

/** The same, but handing back one object it built once — not a fresh one. */
const SHARED = { dense: true };
export function sharedConf(): { dense: boolean } {
  return SHARED;
}
