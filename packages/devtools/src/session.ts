/**
 * Where the panel keeps what it remembers, and the two stores are chosen per question.
 *
 * `localStorage` holds a PREFERENCE — the width, dock or float, which tools are hidden. Those are
 * how the reader likes the panel, and they should survive closing the browser.
 *
 * `sessionStorage` holds a POSITION — which tab was open, what was typed into the filter, which
 * component was pinned. Those belong to the thing being debugged right now: a week later, opening
 * a different app on the same origin, they would restore a state about nothing.
 *
 * Both throw rather than returning null in a sandboxed iframe or with site data blocked, and a
 * devtools panel is the last thing that should take an app down with it — so every access is
 * guarded and a failure means the preference simply does not persist.
 */

export const WIDTH_KEY = "ramonda:devtools-width";
export const MODE_KEY = "ramonda:devtools-mode";
export const HIDE_VALUES_KEY = "ramonda:devtools-hide-values";
export const HIDE_HOOKS_KEY = "ramonda:devtools-hide-hooks";
export const OPEN_KEY = "ramonda:devtools-open";
export const TAB_KEY = "ramonda:devtools-tab";
export const FILTER_KEY = "ramonda:devtools-filter";
export const PIN_KEY = "ramonda:devtools-pin";

export const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not storable here; the preference simply does not persist */
  }
};

export const readSession = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeSession = (key: string, value: string | null): void => {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* not storable here; the session simply does not survive a reload */
  }
};
