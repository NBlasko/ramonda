/**
 * The Forms tab, described for `@ramonda/devtools`.
 *
 * ## Why a form needs a tab at all, when the inspector already shows it
 *
 * A form answers `[INSPECT]()`, so its values and errors already appear on its row in the
 * Components tree. That is the right place to look when you are asking about ONE form you have
 * already found. A tab answers a different question: which forms are live on this page, which of
 * them is invalid, and what exactly is wrong — without hunting through the tree for each.
 *
 * ## Why the row is the form and not the field
 *
 * The obvious shape is a row per field, and it is wrong here: the actions a form has — reset,
 * submit — belong to the WHOLE form, and a contract's actions live on a row. A row per field would
 * have put "reset" on every one of them, meaning the same thing each time.
 *
 * So the form is the row, its values are its value (openable and editable through the panel's own
 * tree), and each field that is actually wrong gets a row of its own underneath. A clean form is
 * one line; a broken one says how it is broken and nothing more.
 *
 * ## The contract, duplicated rather than imported
 *
 * Same reason as `@ramonda/query`: a form package that depended on a devtools package would put a
 * development tool into the dependency graph of every application that ships a form. TypeScript is
 * structural, so the copy is checked at the `register` call.
 *
 * Everything here is behind `__DEV__` at its call site, so a production build strips it.
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

/** The registry, created if this package got here first — either side may load before the other. */
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
