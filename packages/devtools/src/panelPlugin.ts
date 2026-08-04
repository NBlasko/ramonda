/**
 * The contract a tab is described by: DATA, never markup.
 *
 * A panel that took HTML from a plugin would hand the tool being used to diagnose an app over to
 * the app it is diagnosing — one broken template and the panel is the thing that is broken. It
 * would also freeze the panel's own look, because every plugin would have baked today's classes
 * into its output. So a source describes what it has, and the panel decides what that looks like.
 *
 * ## Why rows of typed fields rather than a table
 *
 * A table was the first shape written down, and a query row does not fit in one. It carries a
 * title, badges, a line of metadata with ONE part that ticks on its own, an error that is usually
 * absent, a value the panel already knows how to render and edit, and buttons that exist per row
 * rather than per column. Flattened into cells, all of that becomes strings — and the value stops
 * being a value, which is the part a reader came for.
 *
 * So a row is a card, and every part of it says what KIND it is. The panel can then do the right
 * thing per kind: give a value the JSON tree and the editor it gives everything else, keep a live
 * field's text node in place instead of rebuilding the list under the reader's cursor, and colour a
 * status without the source knowing a single hex code.
 */

/** What a row's dot means. The panel owns the colours; a source only says which of these it is. */
export type RowStatus = "ok" | "busy" | "error" | "idle";

/**
 * One line of a row's metadata.
 *
 * `live` is the interesting one: its text is expected to change on most polls while nothing else
 * about the row does — "updated 12s ago" is the case it exists for. The panel writes those text
 * nodes in place and leaves the rest of the DOM alone, which is what keeps hover, selection and an
 * open editor from being destroyed twice a second by a clock.
 */
export type RowField =
  | { kind: "text"; text: string }
  | { kind: "live"; id: string; text: string }
  | { kind: "badge"; text: string; tone?: "info" | "warn" };

/** A value the panel renders with its own tree, and edits with its own editor. */
export interface RowValue {
  data: unknown;
  /**
   * Shown instead of the tree when `data` is absent.
   *
   * A source can be newer or older than the panel reading it, and a bounded bridge may hand over a
   * one-line summary where the value itself was too large to copy. The row still says something in
   * that case rather than rendering the word `undefined`.
   */
  preview?: string;
  /** Appended to the panel's confirmation after a successful write — "a refetch will replace it". */
  writeNote?: string;
  /**
   * Whether the pencil is offered. A source says no when writing back would be dishonest — a copy
   * that was bounded on its way here would put its own "…" markers into whatever it was read from.
   */
  editable?: boolean;
  /** Applies an edit. Returns a sentence to show on refusal, or `undefined` when it was taken. */
  write?: (value: unknown) => string | undefined;
  /**
   * Moves whenever the data does — a write timestamp, a counter, a hash. Optional, and worth
   * giving whenever the source has one.
   *
   * Without it the panel has to guess from the value's shape, and a guess that reads the shape
   * misses an eighth page appended to a list of seven objects, or a field changed in place. The
   * alternative, stringifying a cached payload on every poll, is the most expensive thing the
   * panel could do.
   */
  revision?: number | string;
}

export interface RowAction {
  id: string;
  label: string;
  /** Shown on hover. Worth using when the action's name is shorter than its meaning. */
  title?: string;
}

export interface PanelRow {
  /** Stable across polls, and unique within the panel. What a value and an action are addressed by. */
  id: string;
  title: string;
  /** Renders the title in a monospace box — for a key, a path, a hash. */
  code?: boolean;
  status?: RowStatus;
  fields?: RowField[];
  error?: string;
  value?: RowValue;
  actions?: RowAction[];
}

/** An optional heading above a run of rows, for a source with more than one of something. */
export interface RowGroup {
  label?: string;
  rows: PanelRow[];
}

export interface PanelSnapshot {
  groups: RowGroup[];
  /** Shown instead of the rows when there are none. A source explains its own emptiness. */
  empty?: string;
}

export interface PanelPlugin {
  /** Bumped when this shape changes. The panel refuses a version it does not know. */
  version: 1;
  /** Unique, lowercase, used as the tab's element ids. */
  id: string;
  /** The tab's caption. Short — it sits in a row of them. */
  label: string;
  /**
   * Read while the tab is open, and never otherwise.
   *
   * PULL, and that is the whole cost model: a cache changes on every fetch, observer and sweep, and
   * pushing all of that into a panel nobody has open would cost something in every development
   * build. Called on a poll, so it should read state rather than compute over it.
   */
  snapshot(): PanelSnapshot;
  /** Invoked when a row's action is pressed. Returns a sentence to show, or nothing. */
  run?(rowId: string, actionId: string): string | undefined;
}

/**
 * Where live panels are found.
 *
 * Registered from an INSTANCE's lifecycle rather than at module import — a provider mounting adds
 * one and unmounting removes it, so the list is exactly the live sources. A registry filled at
 * import time would advertise the module-global pattern the framework steers away from, and would
 * keep answering for a source that is long gone.
 *
 * It lives on `window` because the panel and its sources are separate packages that must not
 * import each other: a query package depending on devtools would put a development tool in every
 * production dependency graph. The same reason `__RAMONDA_INSPECT__` is a global.
 */
export interface PanelRegistry {
  /** Adds a panel, and hands back the function that removes exactly this one. */
  register(plugin: PanelPlugin): () => void;
  /** Every live panel this build knows how to render, in registration order. */
  list(): PanelPlugin[];
  /** Called when the list changes, so a panel can add or drop a tab. */
  subscribe(listener: () => void): () => void;
}

const KEY = "__RAMONDA_PANELS__";

export function panelRegistry(): PanelRegistry {
  const holder = globalThis as unknown as { [KEY]?: PanelRegistry };
  const existing = holder[KEY];
  if (existing) return existing;

  const plugins = new Map<string, PanelPlugin>();
  const listeners = new Set<() => void>();
  const announce = () => {
    for (const listener of [...listeners]) listener();
  };

  const registry: PanelRegistry = {
    register(plugin) {
      // A version this build cannot render is refused rather than half-drawn: the fields it does
      // not know about would silently not appear, which is worse than a tab that is not there.
      if (plugin.version !== 1) return () => {};

      plugins.set(plugin.id, plugin);
      announce();

      return () => {
        // Only if it is still the same one: a provider remounting registers before the old
        // instance's cleanup runs, and deleting blindly would drop the live panel.
        if (plugins.get(plugin.id) !== plugin) return;
        plugins.delete(plugin.id);
        announce();
      };
    },
    list() {
      return [...plugins.values()];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  holder[KEY] = registry;
  return registry;
}
