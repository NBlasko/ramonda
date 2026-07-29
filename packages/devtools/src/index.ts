interface DevLogPayload {
  data: any;
  id: string;
  message: string;
  timestamp: string;
  type: string;
}

interface InspectedNode {
  name: string;
  kind: "component" | "hook";
  state: Record<string, unknown>;
  props?: Record<string, unknown>;
  options?: Record<string, unknown>;
  hooks: InspectedNode[];
  children: InspectedNode[];
  node?: Node;
}

type InspectFn = () => InspectedNode[];

/**
 * What `@ramonda/query` publishes for this panel, and it is a snapshot rather than a live
 * object on purpose: the panel must not be able to hold a cache alive, and it has no
 * business reaching into an entry.
 *
 * The same pull model as `__RAMONDA_INSPECT__` — read while the tab is open, and not at all
 * otherwise. A cache changes on every fetch, observer and invalidate; pushing all of that
 * into a panel nobody is looking at would cost something in every development build.
 */
interface QueryRow {
  key: unknown[];
  hash: string;
  status: string;
  fetchStatus: string;
  observers: number;
  updatedAt: number;
  failureCount: number;
  restored: boolean;
  dataPreview: string;
  error?: string;
}

interface QueryBridge {
  snapshot(): { clients: { index: number; queries: QueryRow[] }[] };
  invalidate(clientIndex: number, hash: string): void;
  remove(clientIndex: number, hash: string): void;
}

/** One step of the pinned component's ancestry, rendered as a breadcrumb. */
interface Crumb {
  name: string;
  kind: "component" | "hook";
  path: string;
}

/** Where a pinned path sits in the freshly read tree — see `locate`. */
interface Located {
  node: InspectedNode;
  /** Its position among its siblings, so the rendered path reproduces the full-tree one. */
  index: number;
  parentPrefix: string;
  /** Ancestors first, the node itself last. */
  trail: Crumb[];
}

interface WalkAcc {
  values: Map<string, string>;
  nodes: Map<string, Node>;
  sig: string[];
}

/**
 * Escapes for BOTH text and attribute positions, which is why the quotes are in here.
 *
 * They were missing, and it broke the Query tab twice over. A query's hash is JSON, so it
 * carries `"` — and `data-q-hash="["products"]"` ends the attribute at the second quote. The
 * parser then read the rest as bare attributes, so `dataset.qHash` was `[` and both buttons
 * looked up an entry that could not exist: invalidate and remove did nothing, silently. The
 * same broken markup is why the age element could never be found either.
 */
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Values may hold functions/DOM/circular refs — never let JSON.stringify throw
// and break the panel.
//
// 200 was chosen when a value was rendered on one clipped line, and it is the reason a props
// block showed `{"entries":{},"defaults":{…` and stopped exactly where the interesting part
// began. A value now scrolls inside its own box, so the cap only has to keep a pathological blob
// off the wire — 8000 characters is a long read and a small string.
const MAX_VALUE_LEN = 8000;
const safeStringify = (v: unknown): string => {
  if (typeof v === "function") return "ƒ()";
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    return "[unserializable]";
  }
  return s.length > MAX_VALUE_LEN ? s.slice(0, MAX_VALUE_LEN) + "…" : s;
};

// Cap the number of log rows kept in the DOM so a long session can't grow the
// panel unboundedly. Newest are prepended, so the oldest is the last child.
const MAX_LOG_NODES = 200;

/** Narrow enough to peek past, wide enough that the drag handle is still there to grab. */
const MIN_PANEL_WIDTH = 280;
const WIDTH_KEY = "ramonda:devtools-width";

/**
 * `localStorage` throws rather than returning null in a sandboxed iframe or with site data
 * blocked, and a devtools panel is the last thing that should take an app down with it.
 */
const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not storable here; the width simply does not persist */
  }
};

// packages/devtools/src/index.ts

class RamondaDevTools extends HTMLElement {
  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private currentX = 20;
  private currentY = 20;

  // Component-tab state (pull model).
  private componentsTabActive = false;
  private queryTabActive = false;
  private queryTimer: ReturnType<typeof setInterval> | undefined;
  /** The last rendered shape of the query list — see `renderQueries`. */
  private queryShape = "";
  private watching = false;
  private lastSig = "";
  private lastValues = new Map<string, string>();
  private nodeMap = new Map<string, Node>();
  private highlighted: HTMLElement | null = null;
  /**
   * The path of the component the reader is working on, or `undefined` for the whole tree.
   *
   * Deliberately not persisted. A path is built from indices and names, so it survives a
   * re-render but says nothing about a different page — restoring it after a reload would
   * usually mean opening on "that component is gone".
   */
  private pinned: string | undefined;
  private filter = "";

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    this.setupDrag();

    // Pull model: the core pings a cheap "tick"; we re-read the live tree only
    // while actively watching (panel open + components tab).
    window.addEventListener("ramonda:tick", () => {
      if (this.watching) this.refreshComponents();
    });

    window.dispatchEvent(new CustomEvent("ramonda:devtools-ready"));
  }

  private get inspect(): InspectFn | undefined {
    return (window as unknown as { __RAMONDA_INSPECT__?: InspectFn }).__RAMONDA_INSPECT__;
  }

  /** Absent unless the app installed `@ramonda/query`, which is the ordinary case. */
  private get queries(): QueryBridge | undefined {
    return (window as unknown as { __RAMONDA_QUERY__?: QueryBridge }).__RAMONDA_QUERY__;
  }

  private setupEventListeners() {
    window.addEventListener("ramonda:logs-sync", (e: any) => {
      const history: DevLogPayload[] = e.detail;
      if (history && Array.isArray(history)) {
        let atLeastOneIsError = false;
        history.forEach((log) => {
          this.addLogToUI(log);
          atLeastOneIsError = atLeastOneIsError || log.type === "error";
        });
        if (atLeastOneIsError) this.openDevTools();
      }
    });

    window.addEventListener("ramonda:dev-log", (e: any) => {
      this.addLogToUI(e.detail);
      if (e.detail.type === "error") this.openDevTools();
    });

    window.addEventListener("ramonda:toggle-devtools", (e: any) => {
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
    if (Number.isFinite(stored) && stored > 0) panel.style.width = `${this.clampWidth(stored)}px`;

    handle.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Otherwise the drag starts a text selection in the app underneath.
      event.preventDefault();

      const startX = event.clientX;
      const startWidth = panel.getBoundingClientRect().width;
      panel.classList.add("resizing");

      // Dragging LEFT widens, so the delta is inverted: the panel is anchored to the right.
      const onMove = (move: PointerEvent) => {
        panel.style.width = `${this.clampWidth(startWidth + (startX - move.clientX))}px`;
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
      <style>
        @keyframes flash-green {
          0% { background: rgba(0, 255, 170, 0.5); }
          100% { background: transparent; }
        }
        .state-row.updated { animation: flash-green 0.8s ease-out; }
        .ramonda-badge {
          position: fixed; bottom: 20px; right: 20px;
          width: 50px; height: 50px; background: #7A4FBF; color: white;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-weight: bold; font-size: 20px; cursor: grab; z-index: 2147483647;
          box-shadow: 0 4px 15px rgba(0,0,0,0.3); user-select: none; touch-action: none;
        }
        .ramonda-overlay {
          position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7);
          z-index: 2147483645; display: none; backdrop-filter: blur(2px);
        }
        /* 620px sits between the original 450 and the 900 that turned out to cover too much of
           the app. It is only a STARTING width — the left edge is a drag handle and the choice
           is remembered, so the default just has to be reasonable rather than right. */
        .ramonda-panel {
          position: fixed; top: 0; right: 0; width: min(620px, 92vw); height: 100vh;
          min-width: 280px; max-width: 96vw;
          container-type: inline-size;
          background: #111; color: #eee; z-index: 2147483647;
          box-shadow: -5px 0 25px rgba(0,0,0,0.5);
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          transform: translateX(100%); display: flex; flex-direction: column;
          border-left: 3px solid #7A4FBF; font-family: sans-serif;
        }
        :host([open]) .ramonda-panel { transform: translateX(0); }
        /* Grab-anywhere-on-the-edge: 8px wide, sitting half outside so the cursor changes just
           before the panel begins. touch-action none, or a pen/touch drag scrolls instead. */
        .ramonda-resize {
          position: absolute; top: 0; bottom: 0; left: -4px; width: 8px;
          cursor: ew-resize; z-index: 2; touch-action: none;
        }
        .ramonda-resize:hover, .ramonda-panel.resizing .ramonda-resize { background: #7A4FBF; }
        /* While dragging, the pointer is over the app, not the handle — without this every
           move selects a paragraph behind the panel. */
        .ramonda-panel.resizing { user-select: none; }
        :host([open]) .ramonda-overlay { display: block; }
        .header { padding: 20px; background: #7A4FBF; color: white; display: flex; justify-content: space-between; align-items: center; }
        .log-item { position: relative; border-bottom: 1px solid #222; padding: 12px 30px 12px 0; font-family: monospace; }
        .delete-btn { position: absolute; right: 0; top: 12px; background: none; border: none; color: #666; cursor: pointer; font-size: 16px; }
        .delete-btn:hover { color: #ff4444; }
        .data-preview { background: #1a1a1a; padding: 8px; border-radius: 4px; margin-top: 8px; font-size: 12px; color: #00ffaa; max-height: 150px; overflow: auto; white-space: pre-wrap; cursor: pointer; }
        .tabs { display: flex; background: #1a1a1a; border-bottom: 1px solid #333; flex-shrink: 0; }
        .tab { flex: 1; padding: 10px; text-align: center; cursor: pointer; border-bottom: 2px solid transparent; color: #888; font-weight: bold; transition: 0.2s; }
        .tab.active { color: #B18AE6; border-bottom: 2px solid #B18AE6; background: #222; }
        /* overflow auto on BOTH axes, because the panel is now as narrow as the reader wants
           it: a deep tree row or a wide query key must be reachable by scrolling rather than
           be reflowed into something unreadable. */
        .tab-content { display: none; padding: 20px; overflow: auto; flex-grow: 1; }
        .tab-content.active { display: block; }
        .component-node { margin-top: 4px; }
        /* Never wrapped: at 300px a nested &lt;ProductDetail /&gt; row would otherwise break across
           lines and the indentation — the only thing telling you where you are — would be lost.
           The row extends past the edge instead, and the tab content scrolls to it. */
        .comp-summary { outline: none; cursor: pointer; white-space: nowrap; }
        .kind-badge { font-size: 9px; padding: 1px 4px; border-radius: 3px; margin-right: 5px; vertical-align: middle; }
        .kind-component { background: #7A4FBF; color: #fff; }
        .kind-hook { background: #6a3; color: #fff; }
        .node-body { padding-left: 12px; border-left: 1px solid #333; margin-left: 5px; }
        /* 11px was unreadable, which is the whole point of this panel. */
        .state-block { background: #1a1a1a; padding: 8px 10px; margin: 6px 0; font-size: 13px;
                       line-height: 1.55; border-left: 2px solid #00ffaa; border-radius: 4px; }
        .state-title { color: #00ffaa; margin-bottom: 4px; font-weight: bold; font-size: 12px;
                       text-transform: uppercase; letter-spacing: .4px; }
        .state-row { display: flex; gap: 6px; align-items: flex-start; }
        .state-row .sk { color: #9a9aa2; flex-shrink: 0; }

        /**
         * A long value is scrollable rather than truncated. The bridge still caps what it sends,
         * but what it sends should be readable in full — a value ending in "…" is the one you
         * needed to see.
         */
        .state-row .sv { color: #eee; white-space: pre-wrap; word-break: break-word;
                         max-height: 6.2em; overflow-y: auto; flex: 1; }
        .state-row .sv::-webkit-scrollbar { width: 8px; }
        .state-row .sv::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 4px; }

        .component-node.leaf .comp-summary { padding-left: 13px; }

        /* A tree row hovered long enough fades the panel, so the highlight it draws on the page
           is not hidden behind the panel drawing it. Delayed, so passing the cursor over the
           tree does not strobe. */
        .ramonda-panel.peek { opacity: 0.12; transition: opacity .25s ease .55s; }
        .ramonda-panel.peek:hover { opacity: 0.12; }
        :host([open]) .ramonda-overlay.peek { opacity: 0; }

        .tools { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 20px; background: #171717;
                 border-bottom: 1px solid #2a2a2a; }
        .tools button { background: #262626; border: 1px solid #383838; color: #ccc; font: inherit;
                        font-size: 12px; padding: 4px 9px; border-radius: 5px; cursor: pointer; }
        .tools button:hover { background: #303030; color: #fff; }
        .tools button.on { background: #7A4FBF; border-color: #7A4FBF; color: #fff; }
        .tool-search { flex: 1 1 130px; min-width: 90px; background: #101010; border: 1px solid #383838;
                       color: #eee; font: inherit; font-size: 12px; padding: 4px 8px; border-radius: 5px; }
        .tool-search::placeholder { color: #666; }
        .tool-search:focus { outline: none; border-color: #7A4FBF; }

        .crumbs { display: none; align-items: center; flex-wrap: wrap; gap: 4px;
                  padding: 8px 20px; background: #14121a; border-bottom: 1px solid #2a2a2a; font-size: 12px; }
        .crumbs.on { display: flex; }
        .crumb { background: none; border: none; color: #9a8fb5; font: inherit; font-size: 12px;
                 padding: 2px 4px; border-radius: 4px; cursor: pointer; }
        .crumb:hover { background: #241f30; color: #fff; }
        .crumb.here { color: #B18AE6; font-weight: bold; cursor: default; }
        .crumb.gone { color: #ffcc00; cursor: default; }
        .crumb-sep { color: #555; }

        .pin-btn { background: none; border: none; color: #4a4a4a; font: inherit; font-size: 12px;
                   padding: 0 4px; cursor: pointer; }
        .comp-summary:hover .pin-btn { color: #9a8fb5; }
        .pin-btn:hover { color: #B18AE6; }

        /**
         * Filtering hides a branch with no match in it. The :has() rule keeps the ancestors of a
         * match, which is what makes the result readable as a TREE rather than as a flat list —
         * you see where the thing you searched for lives.
         *
         * State and props go away while filtering on purpose: a search is for finding, and they
         * are what you scroll past while looking. Focus the component and they are all back.
         */
        #components-container.filtering .component-node { display: none; }
        #components-container.filtering .component-node.hit,
        #components-container.filtering .component-node:has(.hit) { display: block; }
        #components-container.filtering .state-block { display: none; }
        #components-container.filtering .component-node.hit > details > .comp-summary,
        #components-container.filtering .component-node.hit > .comp-summary { background: rgba(122,79,191,.28); border-radius: 4px; }

        #components-container.no-values .state-block { display: none; }
        #components-container.no-hooks .kind-hook { opacity: .5; }
        #components-container.no-hooks .component-node:has(> details > summary .kind-hook),
        #components-container.no-hooks .component-node.leaf:has(.kind-hook) { display: none; }

        .q-client { color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; margin: 14px 0 6px; }
        .q-row { border: 1px solid #333; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; background: #1c1c1c; }
        .q-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .q-status { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .q-key { color: #B18AE6; font-size: 12px; word-break: break-all; }
        .q-fetching { color: #00aaff; font-size: 11px; }
        .q-badge { color: #E9B44C; font-size: 10px; border: 1px solid #E9B44C; border-radius: 3px; padding: 0 4px; }
        .q-meta { color: #888; font-size: 11px; margin-top: 4px; }
        .q-obs { color: #54c98a; }
        .q-idle { color: #888; font-style: italic; }
        .q-error { color: #ff6b6b; font-size: 11px; margin-top: 4px; }
        /* Same treatment as a state value: scrollable, not clipped. */
        .q-data { color: #ccc; font-size: 11px; margin-top: 6px; word-break: break-word;
                  white-space: pre-wrap; max-height: 8em; overflow-y: auto; }
        .q-data::-webkit-scrollbar { width: 8px; }
        .q-data::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 4px; }
        .q-actions { display: flex; gap: 6px; margin-top: 8px; }
        .q-actions button { background: #2a2a2a; border: 1px solid #3a3a3a; color: #ccc; font-size: 11px; padding: 3px 8px; border-radius: 4px; cursor: pointer; }
        .q-actions button:hover { background: #333; color: #fff; }

        /**
         * Narrow-panel layout, driven by a CONTAINER query rather than a media query.
         *
         * The width here is the reader's, set by dragging — the window may be 2560px wide while
         * the panel is 300px. A media rule would read the window and never fire.
         */
        @container (max-width: 440px) {
          .header { padding: 12px 14px; }
          .header h2 { font-size: 15px; }
          .tab { padding: 9px 4px; font-size: 11px; }
          .tab-content { padding: 12px 14px; }
          .tools { padding: 7px 14px; gap: 5px; }
          .crumbs { padding: 7px 14px; }
          .tools button { font-size: 11px; padding: 3px 7px; }
          .q-row { padding: 8px 10px; }
        }
        @container (max-width: 320px) {
          /* Every control keeps its icon and drops its words — four buttons still fit a row. */
          .tools button { flex: 1 1 auto; }
          .tools button .tw { display: none; }
        }
      </style>

    <div class="ramonda-badge">R</div>
    <div class="ramonda-overlay"></div>
    <div class="ramonda-panel">
      <div class="ramonda-resize" title="drag to resize"></div>
      <div class="header">
        <h2 style="margin:0;display:flex;align-items:center;gap:8px"><svg width="18" height="18" viewBox="-32 -32 64 64" aria-hidden="true"><g fill="#fff"><ellipse cy="-14" rx="8.6" ry="14"/><ellipse cy="-14" rx="8.6" ry="14" transform="rotate(72)"/><ellipse cy="-14" rx="8.6" ry="14" transform="rotate(144)"/><ellipse cy="-14" rx="8.6" ry="14" transform="rotate(216)"/><ellipse cy="-14" rx="8.6" ry="14" transform="rotate(288)"/></g><circle r="6.6" fill="#E9B44C"/></svg>Ramonda</h2>
        <button id="close-btn" style="background:none;border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer">×</button>
      </div>
      <div class="tabs">
        <div class="tab active" data-tab="logs">LOGS</div>
        <div class="tab" data-tab="components">COMPONENTS</div>
        <div class="tab" data-tab="query">QUERY</div>
      </div>
      <div id="logs-tab" class="tab-content active">
        <div id="logs-container"></div>
      </div>
      <div id="components-tab" class="tab-content">
        <div class="tools">
          <input id="tree-filter" class="tool-search" type="search" placeholder="filter by name" />
          <button type="button" data-tool="expand" title="expand all">▾<span class="tw"> expand all</span></button>
          <button type="button" data-tool="collapse" title="collapse all">▸<span class="tw"> collapse all</span></button>
          <button type="button" data-tool="values" title="hide state &amp; props">◧<span class="tw"> hide state &amp; props</span></button>
          <button type="button" data-tool="hooks" title="hide hooks">⬡<span class="tw"> hide hooks</span></button>
        </div>
        <div class="crumbs" id="crumbs"></div>
        <div id="components-container">
          <small style="color:#666">No active components…</small>
        </div>
      </div>
      <div id="query-tab" class="tab-content">
        <div id="query-container">
          <small style="color:#666">No query cache…</small>
        </div>
      </div>
    </div>
    `;

    this.setupTabSwitching();
    this.setupTools();
    this.setupResize();
    this.setupNavigation();
    this.shadowRoot!.querySelector("#close-btn")?.addEventListener("click", () => this.toggle());
    this.shadowRoot!.querySelector(".ramonda-overlay")?.addEventListener("click", () => this.toggle());
  }

  private addLogToUI(detail: DevLogPayload) {
    const container = this.shadowRoot!.querySelector("#logs-container");
    if (!container || !detail) return;

    const { type, message, timestamp, data, id } = detail;
    const color = type === "error" ? "#ff4444" : type === "warning" ? "#ffcc00" : "#00aaff";

    const logEl = document.createElement("div");
    logEl.className = "log-item";
    logEl.id = `log-${id}`;

    let dataHtml = "";
    if (data) {
      const dataString = data instanceof Error ? data.message : JSON.stringify(data, null, 2);
      dataHtml = `<div class="data-preview">Data: ${escapeHtml(dataString)}</div>`;
    }

    logEl.innerHTML = `
      <button class="delete-btn">&times;</button>
      <div style="display: flex; gap: 10px; margin-bottom: 5px;">
        <span style="color: ${color}; font-weight: bold;">[${type.toUpperCase()}]</span>
        <span style="color: #888;">${timestamp}</span>
      </div>
      <div style="color: #eee;">${escapeHtml(message)}</div>
      ${dataHtml}
    `;

    logEl.querySelector(".delete-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      logEl.remove();
    });
    logEl.querySelector(".data-preview")?.addEventListener("click", () => {
      console.log(`🌸 Ramonda Log [${id}]:`, data);
    });

    container.prepend(logEl);

    // Evict oldest rows past the cap (keeps the DOM — and dev perf — bounded).
    while (container.children.length > MAX_LOG_NODES) {
      container.lastElementChild?.remove();
    }
  }

  toggle() {
    this.hasAttribute("open") ? this.removeAttribute("open") : this.setAttribute("open", "");
    this.updateWatchState();
    this.updateQueryWatch();
  }

  private openDevTools() {
    this.setAttribute("open", "");
    this.updateWatchState();
    this.updateQueryWatch();
  }

  /**
   * The toolbar: two collapse controls and two filters.
   *
   * All four exist for one task — finding a component in a real app's tree. Expanded state and
   * props are what you want when you have found it and what stand in the way while looking, so
   * hiding them is a class on the container rather than a re-render: instant, and it keeps every
   * `<details>` exactly as the reader left it.
   */
  private setupTools() {
    const root = this.shadowRoot!;
    const container = root.querySelector("#components-container");
    if (!container) return;

    for (const button of Array.from(root.querySelectorAll("[data-tool]"))) {
      button.addEventListener("click", () => {
        const tool = (button as HTMLElement).dataset.tool;

        if (tool === "expand" || tool === "collapse") {
          for (const details of Array.from(container.querySelectorAll("details"))) {
            (details as HTMLDetailsElement).open = tool === "expand";
          }
          return;
        }

        const className = tool === "values" ? "no-values" : "no-hooks";
        const hidden = container.classList.toggle(className);
        button.classList.toggle("on", hidden);
        button.textContent =
          tool === "values"
            ? hidden
              ? "show state & props"
              : "hide state & props"
            : hidden
              ? "show hooks"
              : "hide hooks";
      });
    }
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
      this.pin(crumb.dataset.crumb || undefined);
    });

    const input = root.querySelector("#tree-filter") as HTMLInputElement | null;
    input?.addEventListener("input", () => {
      this.filter = input.value;
      this.applyFilter();
      // A hit inside a collapsed branch is a hit you cannot see. Typing opens everything; the
      // reader can collapse again afterwards, and clearing the filter leaves it as they left it.
      if (this.filter.trim() !== "") {
        for (const details of Array.from(root.querySelectorAll("#components-container details"))) {
          (details as HTMLDetailsElement).open = true;
        }
      }
    });

    /**
     * Escape widens the focus back to the whole tree.
     *
     * Guarded on being open AND pinned, so the panel never swallows an Escape the app wanted —
     * with nothing pinned this listener does nothing at all.
     */
    window.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!this.hasAttribute("open") || this.pinned === undefined) return;
      this.pin(undefined);
    });
  }

  private setupTabSwitching() {
    const tabs = this.shadowRoot!.querySelectorAll(".tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        this.shadowRoot!.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
        tab.classList.add("active");
        const target = (tab as HTMLElement).dataset.tab;
        this.shadowRoot!.getElementById(`${target}-tab`)?.classList.add("active");
        this.componentsTabActive = target === "components";
        this.queryTabActive = target === "query";
        this.updateQueryWatch();
        this.updateWatchState();
      });
    });
  }

  // --- Component inspector (pull model) -------------------------------------

  /**
   * We "watch" only while the panel is open AND the components tab is active.
   * Entering that state tells the core to start emitting ticks and does an
   * initial full render; leaving it tells the core to stop (cheap when hidden).
   */
  private updateWatchState() {
    const shouldWatch = this.hasAttribute("open") && this.componentsTabActive;
    if (shouldWatch === this.watching) return;
    this.watching = shouldWatch;

    if (shouldWatch) {
      window.dispatchEvent(new CustomEvent("ramonda:devtools-watch"));
      this.renderComponentsFull();
    } else {
      window.dispatchEvent(new CustomEvent("ramonda:devtools-unwatch"));
      this.clearHighlight();
    }
  }

  // --- Query cache (pull model, polled while its tab is open) ----------------

  /**
   * Polls while the panel is open AND the query tab is active, and not otherwise.
   *
   * A poll rather than a subscription, and the reason is what a cache is: it changes on
   * every fetch, every observer arriving or leaving, every invalidate and every sweep.
   * Subscribing to all of that would mean the cache notifying a panel that is usually not
   * looking. Four times a second is well under what a human reads, and it stops dead the
   * moment the tab is switched away from.
   */
  private updateQueryWatch() {
    const shouldWatch = this.hasAttribute("open") && this.queryTabActive;

    if (!shouldWatch) {
      if (this.queryTimer !== undefined) {
        clearInterval(this.queryTimer);
        this.queryTimer = undefined;
      }
      return;
    }

    if (this.queryTimer !== undefined) return;
    this.queryShape = "";
    this.renderQueries();
    // Twice a second. Faster buys nothing a human can read, and every tick is a poll of every
    // live cache.
    this.queryTimer = setInterval(() => this.renderQueries(), 500);
  }

  private renderQueries() {
    const container = this.shadowRoot!.querySelector("#query-container");
    if (!container) return;

    const bridge = this.queries;
    if (!bridge) {
      this.write(
        container,
        '<small style="color:#666">No query cache. This tab fills in when a QueryClientProvider is mounted.</small>',
      );
      return;
    }

    const { clients } = bridge.snapshot();
    const total = clients.reduce((sum, c) => sum + c.queries.length, 0);

    if (total === 0) {
      this.write(container, '<small style="color:#666">The cache is empty.</small>');
      return;
    }

    const now = Date.now();
    let html = "";

    for (const client of clients) {
      // The index is only worth showing when there IS more than one — an app usually has a
      // single provider, and a label for it would be noise.
      if (clients.length > 1) {
        html += `<div class="q-client">client ${client.index + 1} · ${
          client.queries.length
        } ${client.queries.length === 1 ? "query" : "queries"}</div>`;
      }

      for (const row of client.queries) {
        html += this.renderQueryRow(client.index, row, now);
      }
    }

    /**
     * The SHAPE, not the html: the age of each entry is rendered as "12s ago", so the markup
     * differs on almost every tick even when nothing about the cache has moved. Comparing the
     * html would therefore rewrite the list twice a second forever.
     *
     * That rewrite is what made the tab flicker while idle — `innerHTML` destroys and rebuilds
     * every row, which resets hover, text selection and focus, and repaints. So the shape (keys,
     * statuses, observer counts, data previews) decides whether to rebuild, and the ages are
     * refreshed in place when it has not changed.
     */
    const shape = clients
      .flatMap((client) =>
        client.queries.map((row) =>
          [
            client.index,
            row.hash,
            row.status,
            row.fetchStatus,
            row.observers,
            row.failureCount,
            row.restored,
            row.dataPreview,
            row.error,
          ].join("|"),
        ),
      )
      .join("\n");

    if (shape === this.queryShape) {
      this.refreshAges(container, clients, now);
      return;
    }

    this.queryShape = shape;
    container.innerHTML = html;
    this.bindQueryActions();
  }

  /** Writes only if the content differs, so an idle panel does not touch the DOM at all. */
  private write(container: Element, html: string): void {
    if (this.queryShape === html) return;
    this.queryShape = html;
    container.innerHTML = html;
  }

  /**
   * Updates just the "updated Ns ago" text, by hash, leaving every node in place.
   *
   * This is the whole reason the ages are in their own element: a text node written directly is
   * the cheapest DOM change there is, and it does not disturb what the reader is doing.
   */
  private refreshAges(container: Element, clients: { index: number; queries: QueryRow[] }[], now: number): void {
    /**
     * Collected and matched in JS, never through an attribute SELECTOR.
     *
     * A hash is built from the key, so it carries quotes and brackets —
     * `0:["products"]` — and interpolating that into `[data-q-age="…"]` produces a selector the
     * parser rejects: `Failed to execute 'querySelector': not a valid selector`. It threw on
     * every poll, four times a second, which is exactly the kind of thing an idle panel must not
     * do. Reading `dataset` instead has no parser to offend.
     */
    const ages = new Map<string, Element>();
    for (const element of Array.from(container.querySelectorAll("[data-q-age]"))) {
      ages.set((element as HTMLElement).dataset.qAge ?? "", element);
    }

    for (const client of clients) {
      for (const row of client.queries) {
        const age = ages.get(`${client.index}:${row.hash}`);
        if (!age) continue;
        const text = this.ageOf(row, now);
        if (age.textContent !== text) age.textContent = text;
      }
    }
  }

  private ageOf(row: QueryRow, now: number): string {
    return row.updatedAt === 0 ? "never" : `${Math.max(0, Math.round((now - row.updatedAt) / 1000))}s ago`;
  }

  private renderQueryRow(clientIndex: number, row: QueryRow, now: number): string {
    const colour = row.status === "error" ? "#ff4444" : row.status === "success" ? "#54c98a" : "#ffcc00";
    const fetching = row.fetchStatus === "fetching";
    const age = this.ageOf(row, now);

    // `observers: 0` is the interesting one: the entry is alive but nobody is watching, so
    // it is waiting out its gcTime. That is the state people ask about.
    const observers =
      row.observers === 0
        ? '<span class="q-idle">0 observers · waiting for gc</span>'
        : `<span class="q-obs">${row.observers} observer${row.observers === 1 ? "" : "s"}</span>`;

    return `
      <div class="q-row">
        <div class="q-head">
          <span class="q-status" style="background:${colour}"></span>
          <code class="q-key">${escapeHtml(JSON.stringify(row.key))}</code>
          ${fetching ? '<span class="q-fetching">fetching…</span>' : ""}
          ${row.restored ? '<span class="q-badge">from server</span>' : ""}
        </div>
        <div class="q-meta">
          ${row.status}${
            row.failureCount > 0 ? ` · ${row.failureCount} failure${row.failureCount === 1 ? "" : "s"}` : ""
          } ·
          updated <span data-q-age="${clientIndex}:${escapeHtml(row.hash)}">${age}</span> · ${observers}
        </div>
        ${row.error ? `<div class="q-error">${escapeHtml(row.error)}</div>` : ""}
        <div class="q-data">${escapeHtml(row.dataPreview)}</div>
        <div class="q-actions">
          <button type="button" data-q-action="invalidate" data-q-client="${clientIndex}" data-q-hash="${escapeHtml(
            row.hash,
          )}">invalidate</button>
          <button type="button" data-q-action="remove" data-q-client="${clientIndex}" data-q-hash="${escapeHtml(
            row.hash,
          )}">remove</button>
        </div>
      </div>`;
  }

  /**
   * There is no "refetch" button, and that is the design rather than an omission: the
   * FETCHER belongs to the observer, not to the cache, so a query nobody is watching has no
   * function to call. `invalidate` is the honest equivalent — it marks the entry stale and
   * asks whoever is watching to refresh.
   */
  private bindQueryActions() {
    const container = this.shadowRoot!.querySelector("#query-container");
    if (!container) return;

    for (const button of Array.from(container.querySelectorAll("[data-q-action]"))) {
      button.addEventListener("click", () => {
        const bridge = this.queries;
        if (!bridge) return;

        const element = button as HTMLElement;
        const clientIndex = Number(element.dataset.qClient);
        const hash = element.dataset.qHash ?? "";

        if (element.dataset.qAction === "invalidate") bridge.invalidate(clientIndex, hash);
        else bridge.remove(clientIndex, hash);

        this.renderQueries();
      });
    }
  }

  /**
   * Recursively walks the inspected tree, building HTML + refresh metadata.
   *
   * `indexOffset` exists for the pinned view: rendering one node means passing a single-element
   * array, and its path has to come out as the path it has in the WHOLE tree — otherwise the pin
   * would not match itself on the next tick, and every value id would move. Offsetting by the
   * node's real sibling index reproduces it exactly, without a second path format to keep in
   * sync with this one.
   */
  private walkTree(nodes: InspectedNode[], prefix: string, acc: WalkAcc, indexOffset = 0): string {
    let html = "";
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const path = `${prefix}/${indexOffset + i}:${n.kind}:${n.name}`;
      if (n.node) acc.nodes.set(path, n.node);

      const stateHtml = this.renderValueBlock("State", n.state, path, "s", acc);
      const propsHtml = this.renderValueBlock("Props", n.props, path, "p", acc);
      // A hook's inputs are its PROPS. They were called options once, the framework renamed
      // them, and this label kept saying the old word to everyone inspecting a hook.
      const optionsHtml = this.renderValueBlock("Props", n.options, path, "o", acc);

      const hooksHtml = this.walkTree(n.hooks, `${path}|h`, acc);
      const childrenHtml = this.walkTree(n.children, path, acc);
      const badge = `<span class="kind-badge kind-${n.kind}">${n.kind === "hook" ? "HOOK" : "CMP"}</span>`;
      // Focus, not select: the button makes this node the root of the panel so its state, props,
      // hooks and children are all that is left on screen. Inside the summary, so it is on the
      // row you are already reading — `preventDefault` in the handler stops it toggling the
      // disclosure it lives in.
      const pin = `<button type="button" class="pin-btn" data-pin="${escapeHtml(path)}" title="focus this ${n.kind}">◎</button>`;
      const label =
        n.kind === "hook"
          ? `<span style="color:#8c6">${escapeHtml(n.name)}</span>`
          : `<span style="color:#B18AE6">&lt;${escapeHtml(n.name)} /&gt;</span>`;

      const body = `${propsHtml}${stateHtml}${optionsHtml}${hooksHtml}${childrenHtml}`;

      // A leaf gets no disclosure triangle: a component with no state, no props, no hooks and
      // no children has nothing to open, and a triangle that reveals emptiness is a lie the
      // reader has to click to disprove.
      html += body
        ? `
        <div class="component-node">
          <details open>
            <summary class="comp-summary" data-path="${escapeHtml(path)}">${badge}${label}${pin}</summary>
            <div class="node-body">${body}</div>
          </details>
        </div>`
        : `
        <div class="component-node leaf">
          <div class="comp-summary" data-path="${escapeHtml(path)}">${badge}${label}${pin}</div>
        </div>`;
    }
    return html;
  }

  /**
   * Builds a labelled key/value block (State or Options) and records its values
   * + signature for the fine-grained refresh path. `slot` ("s"/"o") keeps the
   * two blocks' value ids distinct.
   */
  private renderValueBlock(
    title: string,
    obj: Record<string, unknown> | undefined,
    path: string,
    slot: string,
    acc: WalkAcc,
  ): string {
    const keys = obj ? Object.keys(obj) : [];
    acc.sig.push(`${path}#${slot}[${keys.join(",")}]`);
    if (keys.length === 0) return "";

    const rows = keys
      .map((k) => {
        const vid = `${path}::${slot}::${k}`;
        const val = safeStringify(obj![k]);
        acc.values.set(vid, val);
        return `<div class="state-row"><span class="sk">${escapeHtml(
          k,
        )}:</span> <span class="sv" data-sv="${escapeHtml(vid)}">${escapeHtml(val)}</span></div>`;
      })
      .join("");
    const titleHtml = title ? `<div class="state-title">${title}</div>` : "";
    return `<div class="state-block">${titleHtml}${rows}</div>`;
  }

  private renderComponentsFull() {
    const container = this.shadowRoot!.querySelector("#components-container");
    const inspect = this.inspect;
    if (!container || !inspect) return;

    const tree = inspect();

    /**
     * The FULL tree fills `acc`, even when only a subtree is drawn.
     *
     * `refreshComponents` compares a signature read from the whole tree against `lastSig` to
     * decide whether the structure moved. A signature covering only the pinned subtree would
     * differ from it on every single tick, so the panel would rebuild itself four times a second
     * — the flicker, back again, and only while pinned. The same reason `nodeMap` and the value
     * map are the full ones: a path in them is the same path either way.
     */
    const acc: WalkAcc = { values: new Map(), nodes: new Map(), sig: [] };
    const fullHtml = this.walkTree(tree, "", acc);

    let html = fullHtml;
    let crumbs = "";

    if (this.pinned !== undefined) {
      const found = this.locate(tree, "", this.pinned, []);
      if (found) {
        const sub: WalkAcc = { values: new Map(), nodes: new Map(), sig: [] };
        html = this.walkTree([found.node], found.parentPrefix, sub, found.index);
        crumbs = this.renderCrumbs(found.trail, false);
      } else {
        // Unmounted, or a route away. Say so and show the whole tree again rather than an empty
        // panel: the pin is still there to click off, and the reader can see where they are.
        crumbs = this.renderCrumbs([], true);
      }
    }

    const crumbBar = this.shadowRoot!.querySelector("#crumbs");
    if (crumbBar) {
      crumbBar.innerHTML = crumbs;
      crumbBar.classList.toggle("on", crumbs !== "");
    }

    container.innerHTML = html || `<small style="color:#666">No active components…</small>`;
    this.lastValues = acc.values;
    this.nodeMap = acc.nodes;
    this.lastSig = acc.sig.join(";");
    this.attachInspectorEvents(container);
    this.applyFilter();
  }

  /**
   * Finds a path in a freshly read tree, and the ancestry that leads to it.
   *
   * It rebuilds each candidate path exactly the way `walkTree` does instead of parsing the
   * pinned one. Parsing would need to know that a name cannot contain a separator and that
   * `|h` marks the hooks list — two assumptions that would rot the moment either changes.
   * Recomputing has neither, and one walk of a component tree costs nothing here.
   */
  private locate(nodes: InspectedNode[], prefix: string, target: string, trail: Crumb[]): Located | undefined {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const path = `${prefix}/${i}:${n.kind}:${n.name}`;
      const here = [...trail, { name: n.name, kind: n.kind, path }];

      if (path === target) return { node: n, index: i, parentPrefix: prefix, trail: here };

      const inHooks = this.locate(n.hooks, `${path}|h`, target, here);
      if (inHooks) return inHooks;
      const inChildren = this.locate(n.children, path, target, here);
      if (inChildren) return inChildren;
    }
    return undefined;
  }

  /**
   * The breadcrumb: where the pinned component sits, and a way back up.
   *
   * Its real job is orientation. A pinned subtree looks exactly like a whole app, so without the
   * ancestry you cannot tell whether you are looking at the root or at something six levels
   * down — and every crumb is also a pin, which is how you widen the focus one step at a time.
   */
  private renderCrumbs(trail: Crumb[], missing: boolean): string {
    const all = `<button type="button" class="crumb root" data-crumb="">all components</button>`;
    if (missing) {
      return `${all}<span class="crumb-sep">›</span><span class="crumb gone">the pinned component is no longer mounted</span>`;
    }

    const steps = trail
      .map((crumb, i) => {
        const last = i === trail.length - 1;
        const label = crumb.kind === "hook" ? escapeHtml(crumb.name) : `&lt;${escapeHtml(crumb.name)} /&gt;`;
        return `<span class="crumb-sep">›</span>${
          last
            ? `<span class="crumb here">${label}</span>`
            : `<button type="button" class="crumb" data-crumb="${escapeHtml(crumb.path)}">${label}</button>`
        }`;
      })
      .join("");

    return `${all}${steps}`;
  }

  /** Focuses one component, or the whole tree when given `undefined`. */
  private pin(path: string | undefined): void {
    this.pinned = path;
    this.renderComponentsFull();
  }

  /**
   * Hides every branch with no match in it, by class rather than by re-rendering.
   *
   * A keystroke must not rebuild the tree: that would drop the reader's open/closed state and
   * their scroll position on every letter typed. So a match is a class on the row and the
   * ancestors follow from `:has()` in CSS — which also means the filter survives a structural
   * re-render for free, because it is re-applied from the query and not from the DOM.
   */
  private applyFilter(): void {
    const container = this.shadowRoot!.querySelector("#components-container");
    if (!container) return;

    const query = this.filter.trim().toLowerCase();
    container.classList.toggle("filtering", query !== "");

    for (const summary of Array.from(container.querySelectorAll(".comp-summary"))) {
      const path = summary.getAttribute("data-path") ?? "";
      // The name is the tail of the path, which beats reading `textContent`: that would also
      // match the badge, the pin button and — inside a leaf — nothing predictable.
      const name = path.slice(path.lastIndexOf(":") + 1).toLowerCase();
      summary.closest(".component-node")?.classList.toggle("hit", query !== "" && name.includes(query));
    }
  }

  /**
   * Cheap update path: re-read the tree, and if the STRUCTURE is unchanged,
   * patch only the value cells that changed (and flash them) instead of
   * rebuilding the panel DOM. Structural changes fall back to a full render.
   */
  private refreshComponents() {
    const container = this.shadowRoot!.querySelector("#components-container");
    const inspect = this.inspect;
    if (!container || !inspect) return;

    const tree = inspect();
    const acc: WalkAcc = { values: new Map(), nodes: new Map(), sig: [] };
    this.walkTree(tree, "", acc); // fills acc (html discarded)

    if (acc.sig.join(";") !== this.lastSig) {
      this.renderComponentsFull();
      return;
    }

    for (const [vid, val] of acc.values) {
      if (this.lastValues.get(vid) !== val) {
        const span = container.querySelector(`[data-sv="${vid}"]`);
        if (span) {
          span.textContent = val;
          const row = span.closest(".state-row");
          if (row) {
            row.classList.remove("updated");
            // reflow so the animation restarts
            void (row as HTMLElement).offsetWidth;
            row.classList.add("updated");
          }
        }
      }
    }

    this.lastValues = acc.values;
    this.nodeMap = acc.nodes;
  }

  // Highlight the real DOM node on hover (direct reference — no name matching).
  private attachInspectorEvents(container: Element) {
    container.querySelectorAll(".comp-summary").forEach((summary) => {
      const path = summary.getAttribute("data-path")!;
      summary.addEventListener("mouseenter", () => this.highlight(path));
      summary.addEventListener("mouseleave", () => this.clearHighlight());
    });

    container.querySelectorAll("[data-pin]").forEach((button) => {
      button.addEventListener("click", (event) => {
        // The button lives inside a `<summary>`, and opening the disclosure is that summary's
        // DEFAULT ACTION — so preventing it is what stops a focus click from also collapsing
        // the row it was on.
        event.preventDefault();
        event.stopPropagation();
        this.pin((button as HTMLElement).dataset.pin);
      });
    });
  }

  /**
   * Highlights the real element, and gets out of the way.
   *
   * The panel is 900px of opaque drawer over the page it is describing, so highlighting a
   * component often highlights something behind the panel. `peek` fades the drawer — after a
   * delay carried by the CSS transition, so sweeping the cursor down the tree does not strobe —
   * and it comes straight back on `mouseleave`. Nothing is unmounted and no layout moves, which
   * matters: the element being highlighted must not shift because the panel changed.
   */
  private highlight(path: string) {
    const node = this.nodeMap.get(path);
    if (!node || !(node instanceof HTMLElement)) return;
    this.clearHighlight();
    this.peek(true);
    this.highlighted = node;
    node.dataset.ramondaPrevOutline = node.style.outline;
    node.style.outline = "2px solid #7A4FBF";
    node.style.backgroundColor = "rgba(255, 0, 85, 0.1)";
  }

  /** Fades the drawer while a row is hovered, so the highlight underneath is visible. */
  private peek(on: boolean): void {
    this.shadowRoot!.querySelector(".ramonda-panel")?.classList.toggle("peek", on);
    this.shadowRoot!.querySelector(".ramonda-overlay")?.classList.toggle("peek", on);
  }

  private clearHighlight() {
    this.peek(false);

    const node = this.highlighted;
    if (!node) return;
    node.style.outline = node.dataset.ramondaPrevOutline || "";
    node.style.backgroundColor = "";
    delete node.dataset.ramondaPrevOutline;
    this.highlighted = null;
  }
}

if (!customElements.get("ramonda-devtools")) {
  customElements.define("ramonda-devtools", RamondaDevTools);
}

/**
 * A side-effect module: importing it registers `<ramonda-devtools>` and nothing else. This
 * marks it as an ES module for TypeScript, which otherwise rejects an import of a file with no
 * import or export in it ("is not a module") — which is what an app hits when it imports the
 * panel explicitly, as it must.
 */
export {};
