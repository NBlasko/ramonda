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

interface WalkAcc {
  values: Map<string, string>;
  nodes: Map<string, Node>;
  sig: string[];
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Values may hold functions/DOM/circular refs — never let JSON.stringify throw
// and break the panel.
const MAX_VALUE_LEN = 200;
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

// packages/devtools/src/index.ts

class RamondaDevTools extends HTMLElement {
  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private currentX = 20;
  private currentY = 20;

  // Component-tab state (pull model).
  private componentsTabActive = false;
  private watching = false;
  private lastSig = "";
  private lastValues = new Map<string, string>();
  private nodeMap = new Map<string, Node>();
  private highlighted: HTMLElement | null = null;

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
        .ramonda-panel {
          position: fixed; top: 0; right: 0; width: 450px; height: 100vh;
          background: #111; color: #eee; z-index: 2147483647;
          box-shadow: -5px 0 25px rgba(0,0,0,0.5);
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          transform: translateX(100%); display: flex; flex-direction: column;
          border-left: 3px solid #7A4FBF; font-family: sans-serif;
        }
        :host([open]) .ramonda-panel { transform: translateX(0); }
        :host([open]) .ramonda-overlay { display: block; }
        .header { padding: 20px; background: #7A4FBF; color: white; display: flex; justify-content: space-between; align-items: center; }
        .log-item { position: relative; border-bottom: 1px solid #222; padding: 12px 30px 12px 0; font-family: monospace; }
        .delete-btn { position: absolute; right: 0; top: 12px; background: none; border: none; color: #666; cursor: pointer; font-size: 16px; }
        .delete-btn:hover { color: #ff4444; }
        .data-preview { background: #1a1a1a; padding: 8px; border-radius: 4px; margin-top: 8px; font-size: 12px; color: #00ffaa; max-height: 150px; overflow: auto; white-space: pre-wrap; cursor: pointer; }
        .tabs { display: flex; background: #1a1a1a; border-bottom: 1px solid #333; flex-shrink: 0; }
        .tab { flex: 1; padding: 10px; text-align: center; cursor: pointer; border-bottom: 2px solid transparent; color: #888; font-weight: bold; transition: 0.2s; }
        .tab.active { color: #B18AE6; border-bottom: 2px solid #B18AE6; background: #222; }
        .tab-content { display: none; padding: 20px; overflow-y: auto; flex-grow: 1; }
        .tab-content.active { display: block; }
        .component-node { margin-top: 4px; }
        .comp-summary { outline: none; cursor: pointer; }
        .kind-badge { font-size: 9px; padding: 1px 4px; border-radius: 3px; margin-right: 5px; vertical-align: middle; }
        .kind-component { background: #7A4FBF; color: #fff; }
        .kind-hook { background: #6a3; color: #fff; }
        .node-body { padding-left: 12px; border-left: 1px solid #333; margin-left: 5px; }
        .state-block { background: #1a1a1a; padding: 5px; margin: 5px 0; font-size: 11px; border-left: 2px solid #00ffaa; }
        .state-title { color: #00ffaa; margin-bottom: 3px; font-weight: bold; }
        .state-row .sk { color: #888; }
        .state-row .sv { color: #eee; }
      </style>

    <div class="ramonda-badge">R</div>
    <div class="ramonda-overlay"></div>
    <div class="ramonda-panel">
      <div class="header">
        <h2 style="margin:0;display:flex;align-items:center;gap:8px"><svg width="18" height="18" viewBox="-32 -32 64 64" aria-hidden="true"><g fill="#fff"><ellipse cy="-14" rx="8.6" ry="14"/><ellipse cy="-14" rx="8.6" ry="14" transform="rotate(72)"/><ellipse cy="-14" rx="8.6" ry="14" transform="rotate(144)"/><ellipse cy="-14" rx="8.6" ry="14" transform="rotate(216)"/><ellipse cy="-14" rx="8.6" ry="14" transform="rotate(288)"/></g><circle r="6.6" fill="#E9B44C"/></svg>Ramonda</h2>
        <button id="close-btn" style="background:none;border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer">×</button>
      </div>
      <div class="tabs">
        <div class="tab active" data-tab="logs">LOGS</div>
        <div class="tab" data-tab="components">COMPONENTS</div>
      </div>
      <div id="logs-tab" class="tab-content active">
        <div id="logs-container"></div>
      </div>
      <div id="components-tab" class="tab-content">
        <div id="components-container">
          <small style="color:#666">No active components…</small>
        </div>
      </div>
    </div>
    `;

    this.setupTabSwitching();
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
  }

  private openDevTools() {
    this.setAttribute("open", "");
    this.updateWatchState();
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

  /** Recursively walks the inspected tree, building HTML + refresh metadata. */
  private walkTree(nodes: InspectedNode[], prefix: string, acc: WalkAcc): string {
    let html = "";
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const path = `${prefix}/${i}:${n.kind}:${n.name}`;
      if (n.node) acc.nodes.set(path, n.node);

      const stateHtml = this.renderValueBlock("State", n.state, path, "s", acc);
      const propsHtml = this.renderValueBlock("Props", n.props, path, "p", acc);
      const optionsHtml = this.renderValueBlock("Options", n.options, path, "o", acc);

      const hooksHtml = this.walkTree(n.hooks, `${path}|h`, acc);
      const childrenHtml = this.walkTree(n.children, path, acc);
      const badge = `<span class="kind-badge kind-${n.kind}">${n.kind === "hook" ? "HOOK" : "CMP"}</span>`;
      const label =
        n.kind === "hook"
          ? `<span style="color:#8c6">${escapeHtml(n.name)}</span>`
          : `<span style="color:#B18AE6">&lt;${escapeHtml(n.name)} /&gt;</span>`;

      html += `
        <div class="component-node">
          <details open>
            <summary class="comp-summary" data-path="${escapeHtml(path)}">${badge}${label}</summary>
            <div class="node-body">${propsHtml}${stateHtml}${optionsHtml}${hooksHtml}${childrenHtml}</div>
          </details>
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
        return `<div class="state-row"><span class="sk">${escapeHtml(k)}:</span> <span class="sv" data-sv="${escapeHtml(vid)}">${escapeHtml(val)}</span></div>`;
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
    const acc: WalkAcc = { values: new Map(), nodes: new Map(), sig: [] };
    const html = this.walkTree(tree, "", acc);

    container.innerHTML = html || `<small style="color:#666">No active components…</small>`;
    this.lastValues = acc.values;
    this.nodeMap = acc.nodes;
    this.lastSig = acc.sig.join(";");
    this.attachInspectorEvents(container);
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
  }

  private highlight(path: string) {
    const node = this.nodeMap.get(path);
    if (!node || !(node instanceof HTMLElement)) return;
    this.clearHighlight();
    this.highlighted = node;
    node.dataset.ramondaPrevOutline = node.style.outline;
    node.style.outline = "2px solid #7A4FBF";
    node.style.backgroundColor = "rgba(255, 0, 85, 0.1)";
  }

  private clearHighlight() {
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
