/**
 * The Query tab, described for `@ramonda/devtools` — and described here rather than there.
 *
 * ## Why the description lives in this package
 *
 * The panel used to know what a query row looks like: which badge means fetching, that
 * `observers: 0` is worth calling out, that a bounded copy must not be editable. All of that is
 * knowledge about a CACHE, and it was sitting in a package whose subject is a panel — so every
 * change to the query model meant editing devtools, and a library outside this repo could never
 * have a tab at all.
 *
 * Now it is the other way round: this file says what the cache has, the panel decides what that
 * looks like, and `@ramonda/devtools` contains nothing about queries.
 *
 * ## The contract, and why it is duplicated rather than imported
 *
 * The types below mirror `PanelPlugin` in `@ramonda/devtools`. They are written out again instead
 * of imported for the same reason `__RAMONDA_INSPECT__` is a global rather than an import: a query
 * package that depended on a devtools package would put a development tool into the dependency
 * graph of every application that ships a query. TypeScript is structural, so the duplication is
 * checked where it matters — at the `register` call, against whatever the panel actually accepts.
 *
 * The registry is reached through `globalThis` and CREATED here if it does not exist yet. Either
 * side may load first: an app's provider can mount before the panel's lazy import resolves, and a
 * page with no devtools at all still registers into a registry nobody reads. That costs one Map.
 *
 * Everything here is behind `__DEV__` at its call site, so a production build strips the
 * registration and nothing is installed.
 */

type RowStatus = "ok" | "busy" | "error" | "idle";

type RowField =
  | { kind: "text"; text: string }
  | { kind: "live"; id: string; text: string }
  | { kind: "badge"; text: string; tone?: "info" | "warn" };

interface RowValue {
  data: unknown;
  preview?: string;
  editable?: boolean;
  write?: (value: unknown) => string | undefined;
  writeNote?: string;
  revision?: number | string;
}

interface PanelRow {
  id: string;
  title: string;
  code?: boolean;
  status?: RowStatus;
  fields?: RowField[];
  error?: string;
  value?: RowValue;
  actions?: { id: string; label: string; title?: string }[];
}

interface PanelSnapshot {
  groups: { label?: string; rows: PanelRow[] }[];
  empty?: string;
}

interface PanelPlugin {
  version: 1;
  id: string;
  label: string;
  snapshot(): PanelSnapshot;
  run?(rowId: string, actionId: string): string | undefined;
}

interface PanelRegistry {
  register(plugin: PanelPlugin): () => void;
  list(): PanelPlugin[];
  subscribe(listener: () => void): () => void;
}

const KEY = "__RAMONDA_PANELS__";

/** The registry, created if this package got here first. See the note at the top. */
function panelRegistry(): PanelRegistry {
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
      if (plugin.version !== 1) return () => {};
      plugins.set(plugin.id, plugin);
      announce();
      return () => {
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

export { panelRegistry };
export type { PanelPlugin, PanelRegistry, PanelRow, PanelSnapshot, RowField, RowValue };
