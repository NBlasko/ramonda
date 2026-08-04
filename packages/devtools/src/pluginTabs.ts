import { escapeHtml } from "./format";
import type { PanelPlugin, PanelRegistry } from "./panelPlugin";
import { PluginTab } from "./pluginTab";
import type { ValueView } from "./valueView";

/**
 * Every registered panel, as a tab that exists because something registered it.
 *
 * This is what makes the plugin contract worth having. Before it, adding a source meant adding a
 * tab to the panel's HTML, a field to hold whether it was active, a branch in the tab switcher and
 * a renderer of its own — four edits to this package for something that belongs to another one.
 * A source now describes itself and a tab appears.
 *
 * ## Sync, not rebuild
 *
 * A provider mounting mid-session adds a tab; the last one unmounting takes it away. Both are
 * handled by reconciling what is in the DOM against what the registry lists, so the reader's
 * current tab, scroll position and open editor survive a source appearing next to it.
 *
 * ## One timer for all of them
 *
 * The active tab is polled; the rest are not read at all. That is the same pull model each tab had
 * on its own, with one interval instead of one per source — a page with four panels registered
 * costs exactly what a page with one does.
 */
export class PluginTabs {
  private readonly tabs = new Map<string, PluginTab>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private activeId: string | undefined;
  private panelOpen = false;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly root: ShadowRoot,
    private readonly registry: PanelRegistry,
    private readonly values: ValueView,
    private readonly toast: (message: string) => void,
    /** Called when a tab is added or removed, so the panel can re-bind its tab bar. */
    private readonly onChange: () => void,
  ) {}

  /** Builds the tabs that exist now, and keeps them in step from here on. */
  start(): void {
    this.sync();
    // Announced for the FIRST sync too, not only for later ones: a tab built here has no click
    // handler until the panel binds it, and one that looks like a tab and does nothing is worse
    // than one that is not there.
    this.onChange();

    this.unsubscribe = this.registry.subscribe(() => {
      this.sync();
      this.onChange();
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.stopPolling();
  }

  /** The panel's tab switcher tells it which one is showing — `undefined` for a built-in tab. */
  setActive(id: string | undefined, panelOpen: boolean): void {
    this.activeId = id;
    this.panelOpen = panelOpen;

    if (id === undefined || !panelOpen) {
      this.stopPolling();
      return;
    }

    this.tabs.get(id)?.reset();
    this.render();
    if (this.timer !== undefined) return;
    // Twice a second. Faster buys nothing a human can read, and every tick reads a live source.
    this.timer = setInterval(() => this.render(), 500);
  }

  private stopPolling(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private render(): void {
    const id = this.activeId;
    if (id === undefined || !this.panelOpen) return;

    const plugin = this.registry.list().find((candidate) => candidate.id === id);
    const tab = this.tabs.get(id);
    if (plugin && tab) tab.render(plugin);
  }

  /**
   * Reconciles the DOM against the registry.
   *
   * Additive and subtractive, never a rebuild: a source registering while the reader has a value
   * open in another tab must not take that away from them.
   */
  private sync(): void {
    const plugins = this.registry.list();
    const wanted = new Set(plugins.map((plugin) => plugin.id));

    for (const [id, _tab] of [...this.tabs]) {
      if (wanted.has(id)) continue;
      this.root.querySelector(`.tab[data-plugin="${cssEscape(id)}"]`)?.remove();
      this.root.getElementById(`plugin-${id}-tab`)?.remove();
      this.tabs.delete(id);
      // The reader was looking at a source that has gone. The panel puts them back on Logs.
      if (this.activeId === id) this.activeId = undefined;
    }

    for (const plugin of plugins) {
      if (this.tabs.has(plugin.id)) continue;
      this.mount(plugin);
      this.tabs.set(plugin.id, new PluginTab(this.root, this.values, this.toast));
    }
  }

  private mount(plugin: PanelPlugin): void {
    const bar = this.root.querySelector(".tabs");
    const body = this.root.querySelector(".panel-body") ?? bar?.parentElement;
    if (!bar || !body) return;

    const tab = document.createElement("div");
    tab.className = "tab";
    // `data-plugin` as well as `data-tab`: the switcher reads `data-tab` for every tab, and this
    // says which of them the registry owns — so a built-in is never removed by a sync.
    tab.dataset.tab = `plugin-${plugin.id}`;
    tab.dataset.plugin = plugin.id;
    tab.textContent = plugin.label;
    bar.appendChild(tab);

    const content = document.createElement("div");
    content.id = `plugin-${plugin.id}-tab`;
    content.className = "tab-content";
    content.innerHTML = `<div id="plugin-${escapeHtml(plugin.id)}-container"></div>`;
    body.appendChild(content);
  }
}

/**
 * A plugin id in an attribute selector.
 *
 * Ids are the source's to choose, so this cannot assume they are tame — the same lesson a query
 * hash taught, where quotes in an interpolated selector threw on every poll. `CSS.escape` where it
 * exists, and a conservative reject where it does not.
 */
function cssEscape(id: string): string {
  const escape = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS?.escape;
  return escape ? escape(id) : id.replace(/["\\]/g, "\\$&");
}
