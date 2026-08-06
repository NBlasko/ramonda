import { PANEL_CSS } from "./styles";
import { bridgeDiagnosticsToPanel, diagnosticsReachUs } from "./diagnostics";
import { escapeHtml, safeJson, toServerPath } from "./format";
import { resolveOriginal } from "./sourceMap";
import { ValueView } from "./valueView";
import { ProfileTab } from "./profileTab";
import { PluginTabs } from "./pluginTabs";
import { panelRegistry } from "./panelPlugin";
import { ComponentsTab } from "./componentsTab";
import { bloom, icon } from "@ramonda/theme";
import {
  FILTER_KEY,
  MODE_KEY,
  OPEN_KEY,
  PIN_KEY,
  TAB_KEY,
  WIDTH_KEY,
  read,
  readSession,
  write,
  writeSession,
} from "./session";

interface DevLogPayload {
  data: any;
  id: string;
  message: string;
  timestamp: string;
  type: string;
}

const MAX_LOG_NODES = 200;
/** Narrow enough to peek past, wide enough that the drag handle is still there to grab. */
const MIN_PANEL_WIDTH = 280;

class RamondaDevTools extends HTMLElement {
  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private currentX = 20;
  private currentY = 20;

  // Component-tab state (pull model).
  private componentsTabActive = false;
  private profileTabActive = false;
  /**
   * Reading and editing values, shared by every tab that shows one — see `valueView.ts`.
   *
   * Assigned in the constructor, from the shadow root `attachShadow` returns, so that everything
   * after construction can use it without checking whether it exists. `bind()` comes later, in
   * `connectedCallback`: the full view's controls are part of the panel's HTML.
   *
   * It holds the two value maps. They stay separate — the component map is REPLACED on every
   * structural render, and sharing one meant that switching to the Components tab with a query
   * value open reported it as gone, which it was not.
   */
  private readonly values: ValueView;
  /** The profiler tab, which owns its own poll timer and what it last drew — see `profileTab.ts`. */
  private readonly profileTab: ProfileTab;
  /** Every tab a source registered, built and polled here — see `pluginTabs.ts`. */
  private readonly pluginTabs: PluginTabs;
  /** The component tree and its tools — see `componentsTab.ts`. */
  private readonly componentsTab: ComponentsTab;
  /** False once the element leaves the DOM — see `disconnectedCallback`. */
  private alive = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    this.values = new ValueView(root);
    this.profileTab = new ProfileTab(root);
    this.pluginTabs = new PluginTabs(
      root,
      panelRegistry(),
      this.values,
      (message) => this.toast(message),
      () => this.setupTabSwitching(),
    );
    this.componentsTab = new ComponentsTab(
      this,
      root,
      this.values,
      (message) => this.toast(message),
      (file, line, column) => void this.openInEditor(file, line, column),
    );
  }

  connectedCallback() {
    this.alive = true;
    this.render();
    // After render(), because it binds the full view's controls and those are in that HTML.
    this.values.bind();
    this.profileTab.bind();

    this.pluginTabs.start();
    this.setupEventListeners();
    this.setupDrag();

    // Pull model: the core pings a cheap "tick"; we re-read the live tree only
    // while actively watching (panel open + components tab).
    window.addEventListener("ramonda:tick", () => {
      if (this.alive && this.componentsTab.isWatching) this.componentsTab.refreshComponents();
    });

    this.restoreSession();

    /**
     * Says so when the diagnostics sink no longer reaches this panel.
     *
     * The sink is one property on `globalThis`, and the reference page shows how
     * to assign it — so somebody following that example, or a second collector
     * written by hand, replaces the bridge and the Logs tab quietly stops filling.
     * There is no hook that fires when a global is overwritten, so the check is a
     * round trip, run once here rather than per report.
     */
    if (!diagnosticsReachUs()) {
      // Not a diagnostic code, and this package raises none: it is the collector, not a reporter.
      // What it has to say is about ITSELF — that the channel it reads was taken — which no code in
      // any registry describes.
      console.warn(
        "[Ramonda devtools] Something replaced `globalThis.__RAMONDA_DIAGNOSTICS__`, so reports " +
          "from lens and any other package are no longer reaching this panel. Subscribe with " +
          "`installDiagnostics(sink)` from `@ramonda/devtools` instead of assigning the global, " +
          "which lets several collectors share it.",
      );
    }

    window.dispatchEvent(new CustomEvent("ramonda:devtools-ready"));
  }

  /**
   * Picks the reader's debugging session back up: the tab they were on, what they were filtering
   * for, the component they had focused, and whether the panel was open at all.
   *
   * Last in `connectedCallback`, after every listener exists, and it goes through the same paths a
   * click does — the tab is restored by dispatching a click on it — so there is one code path that
   * opens a tab and not two that have to agree.
   *
   * A reload during a debugging session is not an interruption to recover from; it is part of the
   * session. What does NOT come back is anything from another tab or another day: `sessionStorage`
   * ends with the tab, which is right for a focused path, since it names a tree that no longer
   * exists.
   */
  private restoreSession(): void {
    const root = this.shadowRoot!;

    const filter = readSession(FILTER_KEY);
    if (filter) {
      const input = root.querySelector("#tree-filter") as HTMLInputElement | null;
      if (input) input.value = filter;
    }

    this.componentsTab.restore(filter, readSession(PIN_KEY));

    const tab = readSession(TAB_KEY);
    if (tab && tab !== "logs") root.querySelector(`.tab[data-tab="${tab}"]`)?.dispatchEvent(new Event("click"));

    if (readSession(OPEN_KEY) === "1") {
      this.setAttribute("open", "");
      this.applyLayout();
      this.componentsTab.watch(this.hasAttribute("open") && this.componentsTabActive);
      this.pluginTabs.setActive(this.activePluginId, this.hasAttribute("open"));
      this.profileTab.watch(this.hasAttribute("open") && this.profileTabActive);
    }
  }

  /**
   * Leaves the page exactly as it was found.
   *
   * In an app the panel is mounted once and never removed, so this is not a cleanup anybody
   * waits for — but a docked panel puts a margin on the body and a picking one puts a crosshair
   * on the cursor, and both would outlive the element that owns them. A test mounts and drops
   * the panel repeatedly, which is where that leak shows up first.
   */
  disconnectedCallback() {
    /**
     * Every window listener here is guarded on this flag rather than removed.
     *
     * A removed panel that still listens is not a hypothetical: a test mounts several, and the
     * first `ramonda:dev-log` after that reached ALL of them — so a dead panel opened itself and
     * wrote a margin onto the live document's body. Guarding is provably complete in a way that
     * bookkeeping a dozen listener references is not, and it costs one comparison per event.
     */
    this.alive = false;
    this.componentsTab.setPicking(false);
    if (this.docked) {
      document.body.style.marginRight = this.savedMargin;
      this.docked = false;
    }

    /**
     * The polling tabs, stopped here rather than left to the flag above.
     *
     * A guard cannot help an interval: it fires whether or not anyone reads the result, and both of
     * these poll a BRIDGE — so a removed panel kept asking the query cache for a snapshot and the
     * profiler for its commits, forever. Measured before this line existed: a panel taken out of the
     * document called `commits()` thirteen more times over five seconds and did not stop.
     */
    this.pluginTabs.stop();
    this.profileTab.stop();
    this.componentsTab.stop();
  }

  private setupEventListeners() {
    window.addEventListener("ramonda:logs-sync", (e: any) => {
      if (!this.alive) return;
      const history: DevLogPayload[] = e.detail;
      if (history && Array.isArray(history)) {
        let errors = 0;
        history.forEach((log) => {
          this.addLogToUI(log);
          if (log.type === "error") errors++;
        });
        if (errors > 0) this.alertError(errors);
      }
    });

    window.addEventListener("ramonda:dev-log", (e: any) => {
      if (!this.alive) return;
      this.addLogToUI(e.detail);
      if (e.detail.type === "error") this.alertError();
    });

    window.addEventListener("ramonda:toggle-devtools", (e: any) => {
      if (!this.alive) return;
      e.detail?.forceOpen ? this.openDevTools() : this.toggle();
    });
  }

  /**
   * The left edge resizes the panel, and the width survives a reload.
   *
   * Worth saying why this exists at all: the panel OVERLAYS the app, so its width is a direct
   * trade against how much of the app you can see — and the right answer differs per app and
   * per task. A default cannot be right for both a query table and a narrow highlight check,
   * so it is the reader's to set.
   */
  private setupResize() {
    const panel = this.shadowRoot!.querySelector(".ramonda-panel") as HTMLElement;
    const handle = this.shadowRoot!.querySelector(".ramonda-resize") as HTMLElement;

    const stored = Number(read(WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) this.style.setProperty("--panel-w", `${this.clampWidth(stored)}px`);

    // A window narrowed below the panel's width would otherwise leave the page squeezed to
    // nothing, with no way to see what happened.
    window.addEventListener("resize", () => {
      if (!this.alive) return;
      const width = this.panelWidth();
      const clamped = this.clampWidth(width);
      if (clamped !== width) this.style.setProperty("--panel-w", `${clamped}px`);
      this.applyLayout();
    });

    handle.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Otherwise the drag starts a text selection in the app underneath.
      event.preventDefault();

      const startX = event.clientX;
      const startWidth = panel.getBoundingClientRect().width;
      panel.classList.add("resizing");

      // Dragging LEFT widens, so the delta is inverted: the panel is anchored to the right.
      const onMove = (move: PointerEvent) => {
        // The custom property rather than `style.width`, so the badge offset and the body margin
        // read the same number the panel is drawn at.
        this.style.setProperty("--panel-w", `${this.clampWidth(startWidth + (startX - move.clientX))}px`);
        this.applyLayout();
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        panel.classList.remove("resizing");
        write(WIDTH_KEY, String(Math.round(panel.getBoundingClientRect().width)));
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  /**
   * A width the panel can actually be used at. The floor is not cosmetic — a panel dragged to
   * 20px is unrecoverable, because the handle goes with it.
   */
  private clampWidth(width: number): number {
    return Math.max(MIN_PANEL_WIDTH, Math.min(width, window.innerWidth * 0.96));
  }

  private setupDrag() {
    const badge = this.shadowRoot!.querySelector(".ramonda-badge") as HTMLElement;
    let hasMoved = false;

    const onPointerMove = (e: PointerEvent) => {
      if (!this.isDragging) return;
      if (Math.abs(e.clientX - this.startX) > 5 || Math.abs(e.clientY - this.startY) > 5) {
        hasMoved = true;
      }
      this.currentX = window.innerWidth - e.clientX - 25;
      this.currentY = window.innerHeight - e.clientY - 25;
      badge.style.right = `${this.currentX}px`;
      badge.style.bottom = `${this.currentY}px`;
    };

    const onPointerUp = () => {
      this.isDragging = false;
      badge.style.cursor = "grab";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setTimeout(() => {
        hasMoved = false;
      }, 100);
    };

    badge.addEventListener("animationend", (event: AnimationEvent) => {
      // Only the burst clears itself; the breathing is meant to keep going until the panel is read.
      if (event.animationName.startsWith("boom-shake")) badge.classList.remove("boom");
    });

    badge.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      hasMoved = false;
      badge.style.cursor = "grabbing";
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });

    badge.addEventListener("click", () => {
      if (!hasMoved) this.toggle();
    });
  }

  private render() {
    this.shadowRoot!.innerHTML = `
      <style>${PANEL_CSS}</style>

    <div class="ramonda-badge">R<span class="badge-spark"></span><span class="badge-count" id="badge-count"></span></div>
    <div class="pick-label" id="pick-label"></div>
    <div class="ramonda-panel">
      <div class="ramonda-resize" title="drag to resize"></div>
      <div class="header">
        <h2 style="margin:0;display:flex;align-items:center;gap:8px"><svg width="18" height="18" viewBox="-32 -32 64 64" aria-hidden="true">${bloom({ petals: "var(--rmd-text-strong)", centre: "var(--rmd-gold)", ring: null })}</svg>Ramonda</h2>
        <div class="head-tools">
          <button type="button" id="mode-btn" class="mode-btn">float</button>
          <button id="close-btn" style="background:none;border:none;color:var(--rmd-text-strong);font-size:22px;line-height:1;cursor:pointer">${icon("close")}</button>
        </div>
      </div>
      <div class="mode-note">floating, so the error did not reflow the app it happened in</div>
      <div class="tabs">
        <div class="tab active" data-tab="logs">LOGS</div>
        <div class="tab" data-tab="components">COMPONENTS</div>
        <div class="tab" data-tab="profile">PROFILE</div>
      </div>
      <div id="logs-tab" class="tab-content active">
        <div id="logs-container"></div>
      </div>
      <div id="components-tab" class="tab-content">
        <div class="tree-head">
        <div class="tools">
          <input id="tree-filter" class="tool-search" type="search" placeholder="filter by name" />
          <button type="button" data-tool="pick" title="pick a component from the page">${icon("pick")}<span class="tw"> pick</span></button>
          <button type="button" data-tool="expand" title="expand all">${icon("expand")}<span class="tw"> expand all</span></button>
          <button type="button" data-tool="collapse" title="collapse all">${icon("collapse")}<span class="tw"> collapse all</span></button>
          <button type="button" data-tool="values" title="hide state &amp; props">${icon("values")}<span class="tw"> hide state &amp; props</span></button>
          <button type="button" data-tool="hooks" title="hide hooks">${icon("hooks")}<span class="tw"> hide hooks</span></button>
        </div>
        <div class="crumbs" id="crumbs"></div>
        </div>
        <div id="components-container">
          <small style="color:var(--rmd-text-faint)">No active components…</small>
        </div>
      </div>
      <div class="toast" id="toast"></div>
      <div class="jv-modal" id="jv-modal">
        <div class="jv-modal-head">
          <span class="jv-modal-title" id="jv-modal-title"></span>
          <div class="jv-modal-tools">
            <button type="button" id="jv-refresh" title="the value has not changed">refresh</button>
            <button type="button" id="jv-raw" title="switch between the tree and pretty JSON">raw</button>
            <button type="button" id="jv-copy" title="copy the whole value as JSON">copy</button>
            <button type="button" id="jv-close" title="close (Escape)">${icon("close")}</button>
          </div>
        </div>
        <div class="jv-modal-body" id="jv-modal-body"></div>
      </div>
      <div id="profile-tab" class="tab-content">
        <div class="tools">
          <button type="button" id="profile-record">${icon("record")} record</button>
          <span class="profile-hint" id="profile-hint"></span>
        </div>
        <div id="profile-container"></div>
      </div>
    </div>
    `;

    this.setupTabSwitching();
    this.componentsTab.setupTools();
    this.setupResize();
    this.setupNavigation();
    this.shadowRoot!.querySelector("#close-btn")?.addEventListener("click", () => this.toggle());
    this.shadowRoot!.querySelector("#mode-btn")?.addEventListener("click", () => {
      // An explicit choice, so it also becomes the preference for the next manual open — and it
      // clears the error's override, which is the whole point of the button being there.
      this.mode = this.mode === "float" || this.forcedFloat ? "dock" : "float";
      this.forcedFloat = false;
      write(MODE_KEY, this.mode);
      this.applyLayout();
    });
  }

  private addLogToUI(detail: DevLogPayload) {
    const container = this.shadowRoot!.querySelector("#logs-container");
    if (!container || !detail) return;

    const { type, message, timestamp, data, id } = detail;
    const color = type === "error" ? "var(--rmd-error)" : type === "warning" ? "var(--rmd-warn)" : "var(--rmd-busy)";

    const logEl = document.createElement("div");
    logEl.className = "log-item";
    logEl.id = `log-${id}`;

    let dataHtml = "";
    if (data) {
      const dataString = data instanceof Error ? data.message : safeJson(data);
      dataHtml = `<div class="data-preview">Data: ${escapeHtml(dataString)}</div>`;
    }

    logEl.innerHTML = `
      <button class="delete-btn" title="dismiss this log">${icon("close")}</button>
      <div style="display: flex; gap: 10px; margin-bottom: 5px;">
        <span style="color: ${color}; font-weight: bold;">[${type.toUpperCase()}]</span>
        <span style="color: var(--rmd-text-muted);">${timestamp}</span>
      </div>
      <div style="color: var(--rmd-text-bright);">${escapeHtml(message)}</div>
      ${dataHtml}
    `;

    logEl.querySelector(".delete-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      logEl.remove();
    });
    logEl.querySelector(".data-preview")?.addEventListener("click", () => {
      // `%s`, not an interpolated id: a console treats its first argument as a format string, so an
      // id carrying `%s` — and an id carries names from the app — would swallow `data` into the
      // message. `data` is the entire reason this row is clickable.
      console.log("🌸 Ramonda Log [%s]:", id, data);
    });

    container.prepend(logEl);

    // Evict oldest rows past the cap (keeps the DOM — and dev perf — bounded).
    while (container.children.length > MAX_LOG_NODES) {
      container.lastElementChild?.remove();
    }
  }

  toggle() {
    this.hasAttribute("open") ? this.removeAttribute("open") : this.setAttribute("open", "");
    if (this.hasAttribute("open")) this.clearErrorAlert();
    writeSession(OPEN_KEY, this.hasAttribute("open") ? "1" : null);
    // Opened by hand: the reader's own preference applies.
    this.forcedFloat = false;
    this.applyLayout();
    this.componentsTab.watch(this.hasAttribute("open") && this.componentsTabActive);
    this.pluginTabs.setActive(this.activePluginId, this.hasAttribute("open"));
    this.profileTab.watch(this.hasAttribute("open") && this.profileTabActive);
  }

  /**
   * An error happened: say so loudly, and take nothing.
   *
   * This used to open the panel. Opening is an interruption, and — once the panel docked — it also
   * reflowed the app, which is how a media query flipped and the layout you were shown stopped
   * being the one the error happened in. Floating fixed the reflow, but the interruption was still
   * there: the panel covers the app you were looking at, for a diagnostic you may already know
   * about.
   *
   * So the badge does the work. It detonates — a shake, two expanding rings and a spray of sparks,
   * about a second of it — and then stays red with a count until you look. Impossible to miss,
   * costs nothing, and what you were doing is exactly where you left it. A second error detonates
   * again: the animation is restarted from JS (remove the class, force a reflow, add it back),
   * because re-adding a class that is already there does not replay anything.
   */
  private alertError(count = 1): void {
    this.unseenErrors += count;

    const badge = this.shadowRoot!.querySelector(".ramonda-badge") as HTMLElement | null;
    const bubble = this.shadowRoot!.querySelector("#badge-count") as HTMLElement | null;
    if (!badge || !bubble) return;

    bubble.textContent = this.unseenErrors > 99 ? "99+" : String(this.unseenErrors);
    this.classList.add("has-errors");

    badge.classList.remove("boom");
    void badge.offsetWidth;
    badge.classList.add("boom");
  }

  /** Read: the count goes, and the badge stops shouting. */
  private clearErrorAlert(): void {
    if (this.unseenErrors === 0) return;
    this.unseenErrors = 0;
    this.classList.remove("has-errors");
    this.shadowRoot!.querySelector(".ramonda-badge")?.classList.remove("boom");
  }

  private unseenErrors = 0;

  /**
   * Opened by the framework, not by the reader — a dev error, a diagnostic.
   *
   * `forcedFloat` is only set when the panel was CLOSED. An error arriving while it is already
   * open and docked must change nothing: reflowing the app on the second error would destroy the
   * layout the reader is in the middle of reading.
   */
  private openDevTools() {
    if (!this.hasAttribute("open")) this.forcedFloat = true;
    this.setAttribute("open", "");
    this.clearErrorAlert();
    writeSession(OPEN_KEY, "1");
    this.applyLayout();
    this.componentsTab.watch(this.hasAttribute("open") && this.componentsTabActive);
    this.pluginTabs.setActive(this.activePluginId, this.hasAttribute("open"));
    this.profileTab.watch(this.hasAttribute("open") && this.profileTabActive);
  }

  /**
   * Docked, or floating — and the difference exists for one reason.
   *
   * Docking squeezes the page, which is right when you open the panel yourself: nothing is hidden
   * behind it. But the panel also opens ITSELF, on a dev error, and there squeezing is destructive:
   * the app reflows, a media query flips, and what you are then looking at is a different layout
   * from the one that produced the error. The evidence changes because the tool arrived.
   *
   * So an error-triggered open floats — it is exactly the case that needs the old overlay
   * behaviour, and the only one. What the overlay was really providing was "does not reflow", so
   * that is what floating is; the dimming is not back, because dimming the app you are debugging
   * was never the useful part. One click docks it when you want the space instead.
   */
  private applyLayout(): void {
    const open = this.hasAttribute("open");
    const floating = this.mode === "float" || this.forcedFloat;

    this.classList.toggle("floating", floating);
    this.classList.toggle("forced-float", this.forcedFloat);
    const button = this.shadowRoot?.querySelector("#mode-btn") as HTMLElement | null;
    if (button) {
      button.textContent = floating ? "dock" : "float";
      button.title = floating ? "squeeze the page beside the panel" : "let the panel cover the page instead";
    }

    const body = document.body;
    if (!open || floating) {
      if (this.docked) {
        body.style.marginRight = this.savedMargin;
        this.docked = false;
      }
      return;
    }

    if (!this.docked) {
      // The app's own inline margin, so it comes back exactly — the panel leaves no trace in the
      // DOM it borrowed.
      this.savedMargin = body.style.marginRight;
      this.docked = true;
    }
    body.style.marginRight = `${this.panelWidth()}px`;
  }

  private docked = false;
  private savedMargin = "";
  /** The reader's preference, remembered. Errors override it for the open they trigger. */
  private mode: "dock" | "float" = read(MODE_KEY) === "float" ? "float" : "dock";
  /** True while the panel is open because something went wrong rather than because you asked. */
  private forcedFloat = false;

  private panelWidth(): number {
    const panel = this.shadowRoot!.querySelector(".ramonda-panel");
    return panel ? Math.round(panel.getBoundingClientRect().width) : 0;
  }

  /**
   * The breadcrumb bar and the name filter.
   *
   * Bound once, on the bar rather than on each crumb, because the bar is rewritten on every
   * structural render — a listener per crumb would be re-attached each time and would leak the
   * previous ones.
   */
  private setupNavigation() {
    const root = this.shadowRoot!;

    root.querySelector("#crumbs")?.addEventListener("click", (event) => {
      const crumb = (event.target as HTMLElement).closest("[data-crumb]") as HTMLElement | null;
      if (!crumb) return;
      // An empty value is the "all components" crumb: unpin.
      this.componentsTab.pin(crumb.dataset.crumb || undefined);
    });

    const input = root.querySelector("#tree-filter") as HTMLInputElement | null;
    input?.addEventListener("input", () => this.componentsTab.setFilter(input.value));

    /**
     * Escape widens the focus back to the whole tree.
     *
     * Guarded on being open AND pinned, so the panel never swallows an Escape the app wanted —
     * with nothing pinned this listener does nothing at all.
     */
    window.addEventListener("keydown", (event: KeyboardEvent) => {
      if (!this.alive || event.key !== "Escape" || !this.hasAttribute("open")) return;

      // Innermost first: the value you opened, then the component you focused. Picking has its own
      // handler, which captures and stops the event before this one runs.
      if (this.values.isOpen) {
        this.values.close();
        return;
      }
      if (this.componentsTab.isPinned) this.componentsTab.pin(undefined);
    });
  }

  /**
   * Which registered panel is showing, or `undefined` for one of the panel's own tabs.
   *
   * A plugin tab's `data-tab` is `plugin-<id>`, so this is the id back out of it — the switcher
   * treats every tab the same and only this reads which kind it was.
   */
  private activePluginId: string | undefined;

  /**
   * Re-bound whenever a tab is added or removed, because a tab that appeared after this ran would
   * have no click handler — it would look like a tab and do nothing.
   *
   * Binding twice on a surviving tab is prevented by the set: `addEventListener` deduplicates
   * identical listeners, but these are fresh closures, so a second pass would make every click
   * fire twice. Kept in a `WeakSet` rather than an attribute — what the panel has wired is its own
   * bookkeeping, and a marker in the DOM is something a reader has to wonder about.
   */
  private readonly boundTabs = new WeakSet<Element>();

  private setupTabSwitching() {
    const tabs = this.shadowRoot!.querySelectorAll(".tab");
    tabs.forEach((tab) => {
      if (this.boundTabs.has(tab)) return;
      this.boundTabs.add(tab);

      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        this.shadowRoot!.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
        tab.classList.add("active");
        const target = (tab as HTMLElement).dataset.tab;
        this.shadowRoot!.getElementById(`${target}-tab`)?.classList.add("active");
        if (target) writeSession(TAB_KEY, target);
        this.activePluginId = (tab as HTMLElement).dataset.plugin;
        this.componentsTabActive = target === "components";
        this.profileTabActive = target === "profile";
        this.pluginTabs.setActive(this.activePluginId, this.hasAttribute("open"));
        this.profileTab.watch(this.hasAttribute("open") && this.profileTabActive);
        this.componentsTab.watch(this.hasAttribute("open") && this.componentsTabActive);
      });
    });
  }

  // --- Component inspector (pull model) -------------------------------------

  /**
   * Opens a component's definition in the reader's editor.
   *
   * Through the DEV SERVER, not through a `vscode://` link: Vite serves `/__open-in-editor`, which
   * hands the file to `launch-editor` on the machine running the server — so it works for whatever
   * editor is actually open, needs no protocol handler registered, and needs no configuration here.
   * A `vscode://` URL would also need the absolute path, which a browser does not have.
   *
   * When there is no such endpoint — a custom server, this repo's own SSR playground — the location
   * goes to the clipboard instead, with a log row saying so. A button that silently does nothing is
   * worse than one that hands you something to paste.
   */
  private async openInEditor(file: string, rawLine = "1", rawColumn = "1"): Promise<void> {
    const line = rawLine;
    const column = rawColumn;

    /**
     * Resolved through the module's own sourcemap first, and this is not a nicety.
     *
     * A stack reports the file the engine ran. Measured against Vite serving a real playground page,
     * a class declared on source line 20 appears on served line 51 — esbuild lowers decorators and
     * prepends a preamble. Opening thirty lines from the class is a button that looks broken.
     */
    const position = await resolveOriginal(file, Number(line), Number(column));

    /**
     * `file` is what an editor should open; `from` says what a relative `file` is relative to.
     *
     * A map's source for a bundled build is a `../../..` chain out of the bundle's directory on disk,
     * and nothing in the browser can turn that into a path — resolving it here clamped it at the web
     * root and produced `packages/router/src/Link.tsx`, which the server looked for under the app and
     * did not find. So both travel, and the server resolves them together. Vite's own endpoint ignores
     * the extra parameter and gets what it always got.
     */
    const target = `${toServerPath(position.source ?? file)}:${position.line}:${position.column}`;
    const query = position.from
      ? `file=${encodeURIComponent(target)}&from=${encodeURIComponent(toServerPath(position.from))}`
      : `file=${encodeURIComponent(target)}`;

    try {
      const response = await fetch(`/__open-in-editor?${query}`);
      if (response.ok) {
        /**
         * A toast on SUCCESS too, and it is not decoration.
         *
         * An editor that is asked to open a file does not necessarily come to the front — that is the
         * window manager's decision, not ours. Without this, "the editor did not raise" and "the
         * button is broken" look identical, which is exactly the report I got. Now the panel always
         * says what it asked for, and where.
         */
        this.toast(`Asked your editor to open ${target}`);
        return;
      }
      /**
       * 404 means there is no such ENDPOINT — a static server, a hand-written one — and that is the
       * clipboard's case, handled below. Any other status comes from an endpoint that exists and
       * refused, so its own words are the useful thing to show: it knows whether the file was there
       * and whether an editor could be launched.
       */
      if (response.status !== 404) {
        const reason = (await response.text()).trim();
        this.toast(reason ? `Editor endpoint said: ${reason}` : `Editor endpoint answered ${response.status}`);
        return;
      }
      throw new Error("no endpoint");
    } catch {
      /**
       * Reported where the click happened, not only in the log.
       *
       * The first version wrote a log row and nothing else — so on a server with no editor endpoint
       * (this repo's own SSR playground) the button looked dead while it was in fact copying the
       * path to the clipboard in a tab the reader was not looking at. A control must always say what
       * it did.
       */
      let copied = false;
      try {
        await navigator.clipboard.writeText(target);
        copied = true;
      } catch {
        /* no clipboard either; the toast below is the whole answer */
      }
      this.toast(
        copied
          ? `No editor endpoint on this server — copied ${target}`
          : `No editor endpoint on this server. It is at ${target}`,
      );
    }
  }

  /**
   * A short message over the panel, for something that happened because of a click.
   *
   * The log is for what the FRAMEWORK reports; this is for what the panel itself did, and it belongs
   * next to the button that did it. One at a time, replaced rather than queued: the newest outcome is
   * the one being waited for.
   */
  private toast(message: string): void {
    const host = this.shadowRoot!.querySelector("#toast") as HTMLElement | null;
    if (!host) return;

    host.textContent = message;
    host.classList.add("on");
    if (this.toastTimer !== undefined) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => host.classList.remove("on"), 6000);
  }

  private toastTimer: ReturnType<typeof setTimeout> | undefined;
}

if (!customElements.get("ramonda-devtools")) {
  customElements.define("ramonda-devtools", RamondaDevTools);
}

/**
 * Collects diagnostics from every package that reports any, at import time.
 *
 * Import time rather than on mount, for the same reason the vault behind it
 * exists: the reports worth seeing happen while the app starts, which is before a
 * panel element has connected. Calling it twice replaces the first bridge rather
 * than adding a second — see `bridgeDiagnosticsToPanel`.
 */
bridgeDiagnosticsToPanel();

/**
 * Mostly a side-effect module: importing it registers `<ramonda-devtools>`, which is what an app
 * does and all an app needs.
 *
 * What IS exported is the plugin contract — the one thing in this package somebody writes code
 * against. A library with state worth looking at registers a description of it and gets a tab; see
 * `panelPlugin.ts`, and `/devtools/panels` in the docs.
 */
export { panelRegistry } from "./panelPlugin";
export { installDiagnostics } from "./diagnostics";
export type {
  PanelPlugin,
  PanelRegistry,
  PanelRow,
  PanelSnapshot,
  RowAction,
  RowField,
  RowGroup,
  RowStatus,
  RowValue,
} from "./panelPlugin";
