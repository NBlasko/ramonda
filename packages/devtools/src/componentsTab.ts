import { escapeHtml, safeStringify, toOneLine, toServerPath } from "./format";
import { INLINE, renderJsonHtml } from "./jsonView";
import type { ValueView } from "./valueView";
import { FILTER_KEY, HIDE_HOOKS_KEY, HIDE_VALUES_KEY, PIN_KEY, read, write, writeSession } from "./session";
import { brand, icon } from "@ramonda/theme";

interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

interface InspectedNode {
  /** The handle core handed out for this scan — what a write is addressed to. */
  id: number;
  name: string;
  kind: "component" | "hook";
  state: Record<string, unknown>;
  props?: Record<string, unknown>;
  options?: Record<string, unknown>;
  /**
   * What the instance said it holds, from its own `[INSPECT]()`.
   *
   * A hook that keeps its state in plain fields behind a `@state` counter shows that counter as its
   * whole `state` — `{ version: 7 }` for a form, with inputs that never change. This is its own
   * answer, and for a form it is the only thing anyone opens the panel to see.
   */
  detail?: Record<string, unknown>;
  /** A context consumer's reads — the keys it subscribed to, and the ones it never touched. */
  reads?: Record<string, unknown>;
  /** Where the class is defined, when core could tell. */
  source?: SourceLocation;
  hooks: InspectedNode[];
  children: InspectedNode[];
  node?: Node;
}

type InspectFn = () => InspectedNode[];

type WriteFn = (id: number, key: string, value: unknown) => "ok" | "gone" | "not-state" | "unchanged";

/** One component's share of a commit. */

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
  /** One line per value, for change detection only. */
  values: Map<string, string>;
  /** The value itself, for the tree and for the full view. */
  raw: Map<string, unknown>;
  nodes: Map<string, Node>;
  sig: string[];
}

// Cap the number of log rows kept in the DOM so a long session can't grow the
// panel unboundedly. Newest are prepended, so the oldest is the last child.

/**
 * Whether a value can be edited as JSON and come back the same kind of thing.
 *
 * A function, a `Map`, a DOM node, `undefined` — none of them survive `JSON.stringify` followed by
 * `JSON.parse`, so offering a box that appears to edit one is a lie the reader finds out about after
 * pressing Enter.
 */
const isJsonLike = (value: unknown): boolean => {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return true;
  if (kind !== "object") return false;

  try {
    const text = JSON.stringify(value);
    if (text === undefined) return false;
    // Round-tripped, so a `Date` (which stringifies to a string and parses back as one) is out.
    return JSON.stringify(JSON.parse(text)) === text && (Array.isArray(value) || isPlainRecord(value as object));
  } catch {
    return false;
  }
};

/**
 * Whether a value belongs on one line with its key.
 *
 * The test is not "is it a primitive" but **"does the tree render it as a leaf"**, which is the same
 * question the row is asking: only an array or a plain object gets a disclosure and children, so only
 * those need a block. A function is `ƒ()`, a `Date` is one line, and a class instance is its name — the
 * first version of this called those "objects" and gave `client: QueryClient` two lines for a one-word
 * value, which is the shape the whole change was fixing.
 */
const rendersAsLeaf = (value: unknown): boolean => {
  if (Array.isArray(value)) return false;
  if (typeof value !== "object" || value === null) return true;
  return !isPlainRecord(value);
};

const isPlainRecord = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * `App.tsx:18` — what fits in a tooltip, and deliberately the SERVED position rather than the source
 * one. Resolving needs the module's sourcemap, which means a fetch; doing that for every row on
 * every render to fill in a tooltip would be absurd. So the tooltip says where the code was found
 * and the click says where it came from.
 */
const shortFile = (source: SourceLocation): string => {
  const path = toServerPath(source.file);
  return `${path.slice(path.lastIndexOf("/") + 1)}:${source.line}`;
};

/**
 * The component tree: what is mounted, what each instance holds, and the tools for getting to it.
 *
 * The largest tab, and the one the others were measured against. It owns the inspector's pull
 * cycle, the tree walk that builds both the markup and the refresh metadata, the pin and the
 * filter, picking a component off the page, and editing a `@state` field.
 *
 * ## What it is handed
 *
 * The host element and its shadow root, the shared `ValueView`, and two panel-level actions —
 * raising a toast and opening a file in the reader's editor. The host is needed for two things
 * only: the `picking` class, and knowing whether a click landed on the panel itself.
 *
 * ## Pull, like the others
 *
 * It watches only while the panel is open AND this tab is active. Entering that state tells core to
 * start emitting ticks; leaving it tells core to stop, which is what keeps a closed panel free.
 */
export class ComponentsTab {
  constructor(
    private readonly host: HTMLElement,
    private readonly root: ShadowRoot,
    private readonly values: ValueView,
    private readonly toast: (message: string) => void,
    private readonly openInEditor: (file: string, line?: string, column?: string) => void,
  ) {}

  /** True while core is being asked for ticks — the panel's `ramonda:tick` handler reads it. */
  get isWatching(): boolean {
    return this.watching;
  }

  /** Whether a component is focused, which decides what Escape means to the panel. */
  get isPinned(): boolean {
    return this.pinned !== undefined;
  }

  /** Restores what the reader had typed and focused, from the session. */
  restore(filter: string | null, pin: string | null): void {
    if (filter !== null) this.filter = filter;
    if (pin !== null) this.pinned = pin;
  }

  /** The filter box changed: keep it, persist it, and apply it. */
  setFilter(value: string): void {
    this.filter = value;
    writeSession(FILTER_KEY, value || null);
    this.applyFilter();
    // A hit inside a collapsed branch is a hit you cannot see. Typing opens everything; the reader
    // can collapse again afterwards, and clearing the filter leaves it as they left it.
    if (value.trim() === "") return;
    for (const details of Array.from(this.root.querySelectorAll("#components-container details"))) {
      (details as HTMLDetailsElement).open = true;
    }
  }

  /** Teardown: stop asking core for ticks, and put the page back. */
  stop(): void {
    this.watching = false;
    this.clearHighlight();
    this.setPicking(false);
  }

  /** The last rendered shape of the commit list, so an idle poll touches no DOM. */
  private watching = false;

  private lastSig = "";

  private lastValues = new Map<string, string>();

  /** Value id → the element holding its tree, so no selector is ever built from a prop name. */
  private valueElements = new Map<string, HTMLElement>();

  private nodeMap = new Map<string, Node>();

  private highlighted: HTMLElement | null = null;

  /** Paths the reader folded shut. Absent means open, which is the default for a new node. */
  private collapsed = new Set<string>();

  /**
   * The path of the component the reader is working on, or `undefined` for the whole tree.
   *
   * Deliberately not persisted. A path is built from indices and names, so it survives a
   * re-render but says nothing about a different page — restoring it after a reload would
   * usually mean opening on "that component is gone".
   */
  private pinned: string | undefined;

  private filter = "";

  /** Picking from the page: see `setPicking`. */
  private picking = false;

  /**
   * Element → path, the reverse of `nodeMap`, rebuilt on every structural render.
   *
   * A `WeakMap` because the keys are the app's live elements and this panel must never be the
   * reason one of them is kept alive. Insertion follows the walk, so a parent is written before
   * its children — and when a parent and a child share a host element, the deeper one wins, which
   * is the one the cursor is actually over.
   */
  private elementPaths = new WeakMap<Node, string>();

  private get inspect(): InspectFn | undefined {
    return (window as unknown as { __RAMONDA_INSPECT__?: InspectFn }).__RAMONDA_INSPECT__;
  }

  /**
   * Core's write side. Narrow on purpose: one field, addressed by a handle from the last scan, and
   * only when that field is `@state` or `@persist`. There is no way through it to an instance, a
   * method, or a prop.
   */
  private get writer(): WriteFn | undefined {
    return (window as unknown as { __RAMONDA_WRITE__?: WriteFn }).__RAMONDA_WRITE__;
  }

  /**
   * The toolbar: two collapse controls and two filters.
   *
   * All four exist for one task — finding a component in a real app's tree. Expanded state and
   * props are what you want when you have found it and what stand in the way while looking, so
   * hiding them is a class on the container rather than a re-render: instant, and it keeps every
   * `<details>` exactly as the reader left it.
   */
  setupTools() {
    const root = this.root;
    const container = root.querySelector("#components-container");
    if (!container) return;

    for (const button of Array.from(root.querySelectorAll("[data-tool]"))) {
      button.addEventListener("click", () => {
        const tool = (button as HTMLElement).dataset.tool;

        if (tool === "pick") {
          this.setPicking(!this.picking);
          return;
        }

        if (tool === "expand" || tool === "collapse") {
          for (const details of Array.from(container.querySelectorAll("details"))) {
            (details as HTMLDetailsElement).open = tool === "expand";
          }
          // The record follows the DOM, so the next structural rebuild comes back this way too.
          this.syncCollapsed(container);
          return;
        }

        const className = tool === "values" ? "no-values" : "no-hooks";
        this.setTool(tool === "values" ? "values" : "hooks", !container.classList.contains(className));
      });
    }

    // Restored before anything is rendered, so the tree never appears in a state the reader turned
    // off and then flickers into the one they chose.
    if (read(HIDE_VALUES_KEY) === "1") this.setTool("values", true);
    if (read(HIDE_HOOKS_KEY) === "1") this.setTool("hooks", true);
  }

  /** One place for the class, the button's look, its label and the stored preference. */
  private setTool(tool: "values" | "hooks", hidden: boolean): void {
    const root = this.root;
    const container = root.querySelector("#components-container");
    const button = root.querySelector(`[data-tool="${tool}"]`);
    if (!container || !button) return;

    container.classList.toggle(tool === "values" ? "no-values" : "no-hooks", hidden);
    button.classList.toggle("on", hidden);
    const label = tool === "values" ? "state &amp; props" : "hooks";
    button.innerHTML = `${icon(tool === "values" ? "values" : "hooks")}<span class="tw"> ${hidden ? "show" : "hide"} ${label}</span>`;
    write(tool === "values" ? HIDE_VALUES_KEY : HIDE_HOOKS_KEY, hidden ? "1" : "0");
  }

  /**
   * We "watch" only while the panel is open AND the components tab is active.
   * Entering that state tells the core to start emitting ticks and does an
   * initial full render; leaving it tells the core to stop (cheap when hidden).
   */
  watch(shouldWatch: boolean): void {
    if (shouldWatch === this.watching) return;
    this.watching = shouldWatch;

    if (shouldWatch) {
      window.dispatchEvent(new CustomEvent("ramonda:devtools-watch"));
      this.renderComponentsFull();
    } else {
      window.dispatchEvent(new CustomEvent("ramonda:devtools-unwatch"));
      this.clearHighlight();
      // Closing the panel or leaving the tab leaves the page with a crosshair cursor and a
      // handler eating its clicks, with nothing on screen to explain either.
      this.setPicking(false);
    }
  }

  /**
   * Turns one value into an editable box, in place.
   *
   * ## What you are editing
   *
   * The WHOLE field, as JSON — not a path inside it. That is the framework's own rule, not a
   * shortcut: a signal holds a value rather than a proxy, so mutating inside an object notifies
   * nobody. "Change `user.name`" has to become "assign a new `user`", and the panel is held to the
   * same rule as application code.
   *
   * ## Why JSON and not a friendlier parse
   *
   * Because it is unambiguous. `42` is a number, `"42"` is a string, `null` is null — and a reader
   * who types something that is none of those gets told, rather than silently storing the text
   * `[object Object]`. Invalid input never reaches the app: the parse happens first, the box stays
   * open, and the row says what was wrong.
   *
   * Escape cancels, Enter commits a single-line value, and ⌘/Ctrl+Enter commits a multi-line one —
   * where plain Enter has to stay a newline.
   */
  private beginEdit(button: HTMLElement): void {
    const rawId = button.dataset.editNode ?? "";
    const key = button.dataset.editKey ?? "";
    const vid = button.dataset.editVid ?? "";
    const box = this.valueElements.get(vid);
    const writer = this.writer;
    if (!box || !writer) return;

    this.values.openEditor(box, this.values.byId(vid), (parsed) => {
      const result = writer(Number(rawId), key, parsed);
      if (result === "not-state") {
        return `${key} is not @state — props are owned by the parent and cannot be written here`;
      }
      if (result === "gone") return "that component is no longer in the tree";

      this.toast(result === "unchanged" ? `${key} is already that value` : `wrote ${key} = ${toOneLine(parsed)}`);
      // Watched for one refresh: some fields are owned by the machinery around them and are set again
      // immediately, which is the difference between "it worked" and "it did not".
      this.pendingWrite = result === "ok" ? { vid, key, text: safeStringify(parsed) } : undefined;
      return undefined;
    });
  }

  /**
   * The inline JSON editor, shared by a component's state and a query's data.
   *
   * `commit` returns a message to show in the row when it refuses, or `undefined` when it worked — so
   * the two callers keep their own vocabulary ("not @state", "no longer in the cache") without the
   * editor knowing anything about either.
   */

  /** The last value written from the panel, watched for one refresh — see the commit path above. */
  private pendingWrite: { vid: string; key: string; text: string } | undefined;

  /**
   * Notices that the app replaced what was just written from the panel.
   *
   * This is the answer to "I edited it and nothing changed": some fields are owned by the machinery
   * around them — a query's `version` is an invalidation counter, its `snapshot` is the hydration
   * transport — and writing one is honoured and then immediately overwritten. Saying so is the
   * difference between a panel that looks broken and a panel that explains the framework.
   */
  private checkPendingWrite(values: Map<string, string>): void {
    const pending = this.pendingWrite;
    if (!pending) return;
    this.pendingWrite = undefined;

    const current = values.get(pending.vid);
    if (current === undefined || current === pending.text) return;
    this.toast(`${pending.key} was written, and the app has since set it to ${current.slice(0, 60)}`);
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

      // State is the only block that can be written: props are owned by whoever rendered this
      // component and assigning to one throws in every build.
      const stateHtml = this.renderValueBlock("State", n.state, path, "s", acc, n.id);
      // No node id, so it is read-only: this is what the instance DERIVED, and assigning to a copy
      // of it would change nothing while looking as though it had.
      const detailHtml = this.renderValueBlock("Holds", n.detail, path, "d", acc);
      const propsHtml = this.renderValueBlock("Props", n.props, path, "p", acc);
      // A hook's inputs are its PROPS. They were called options once, the framework renamed
      // them, and this label kept saying the old word to everyone inspecting a hook.
      const optionsHtml = this.renderValueBlock("Props", n.options, path, "o", acc);
      // A consumer holds no state and no props, so this is the only block it has — and it is the
      // interesting one: which keys it actually reads is what decides when it re-renders.
      const readsHtml = this.renderValueBlock("Reads from context", n.reads, path, "r", acc);

      const hooksHtml = this.walkTree(n.hooks, `${path}|h`, acc);
      const childrenHtml = this.walkTree(n.children, path, acc);
      const badge = `<span class="kind-badge kind-${n.kind}">${n.kind === "hook" ? "HOOK" : "CMP"}</span>`;
      // Focus, not select: the button makes this node the root of the panel so its state, props,
      // hooks and children are all that is left on screen. Inside the summary, so it is on the
      // row you are already reading — `preventDefault` in the handler stops it toggling the
      // disclosure it lives in.
      const pin = `<button type="button" class="pin-btn" data-pin="${escapeHtml(path)}" title="focus this ${n.kind}">${icon("focus")}</button>`;
      /**
       * The last manual step in the whole flow: you found it, focused it, and then alt-tabbed and
       * searched for the class by name. This closes it.
       *
       * Only when core could say where the class is — a location it could not read is not a button
       * that does nothing.
       */
      const open = n.source
        ? `<button type="button" class="src-btn" data-src-file="${escapeHtml(n.source.file)}" data-src-line="${
            n.source.line
          }" data-src-column="${n.source.column}" title="open the definition in your editor (served at ${escapeHtml(
            shortFile(n.source),
          )})">&lt;/&gt;</button>`
        : "";
      const label =
        n.kind === "hook"
          ? `<span style="color:var(--rmd-hook-text)">${escapeHtml(n.name)}</span>`
          : `<span style="color:var(--rmd-brand-light)">&lt;${escapeHtml(n.name)} /&gt;</span>`;

      const body = `${propsHtml}${stateHtml}${detailHtml}${optionsHtml}${readsHtml}${hooksHtml}${childrenHtml}`;

      // Collapsed is the reader's decision, so it survives a rebuild — the default is open.
      const openAttr = this.collapsed.has(path) ? "" : " open";

      // A leaf gets no disclosure triangle: a component with no state, no props, no hooks and
      // no children has nothing to open, and a triangle that reveals emptiness is a lie the
      // reader has to click to disprove.
      html += body
        ? `
        <div class="component-node">
          <details${openAttr}>
            <summary class="comp-summary" data-path="${escapeHtml(path)}">${badge}${label}${pin}${open}</summary>
            <div class="node-body">${body}</div>
          </details>
        </div>`
        : `
        <div class="component-node leaf">
          <div class="comp-summary" data-path="${escapeHtml(path)}">${badge}${label}${pin}${open}</div>
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
    /** Present only for a writable block — see `beginEdit`. */
    nodeId?: number,
  ): string {
    const keys = obj ? Object.keys(obj) : [];
    acc.sig.push(`${path}#${slot}[${keys.join(",")}]`);
    if (keys.length === 0) return "";

    const rows = keys
      .map((k) => {
        const vid = `${path}::${slot}::${k}`;
        const value = obj![k];
        // The one-line form is kept, but only as a CHANGE SIGNATURE — comparing two strings is
        // cheaper than diffing two trees, and the reader never sees it.
        acc.values.set(vid, safeStringify(value));
        acc.raw.set(vid, value);
        /**
         * A pencil only where a write would actually land, and only for a value that survives a
         * round trip through JSON. A function or a DOM node in state cannot be typed back in, and a
         * control that pretends otherwise is worse than none.
         */
        const editable = nodeId !== undefined && this.writer !== undefined && isJsonLike(value);
        /**
         * Three attributes, not one packed string.
         *
         * It was `${nodeId}|${key}|${vid}` — and a value id contains the node's PATH, which marks a
         * hooks branch with `|h`. So `split("|")` on `1|routeState|/0:component:App|h/0:hook:Router…`
         * handed back a truncated id, the lookup missed, and the pencil did nothing on precisely the
         * rows that have hooks. The unit tests could not see it: their trees put state on components
         * whose paths have no `|` in them. Found by driving the real bundle.
         *
         * The lesson is the one this panel keeps relearning — a query hash in a selector, a prop name
         * in a selector, now a path in a delimiter: never build a delimited string out of data that
         * can contain the delimiter.
         */
        const edit = editable
          ? `<button type="button" class="edit-btn" data-edit-node="${nodeId}" data-edit-key="${escapeHtml(
              k,
            )}" data-edit-vid="${escapeHtml(vid)}" title="edit ${escapeHtml(k)}">${icon("edit")}</button>`
          : "";

        /**
         * A scalar sits on the SAME line as its key; only a container gets a block of its own.
         *
         * Every value used to be a heading with a body underneath, which was reasonable while every
         * value was a tree and looked wrong the moment most of them were `3` and `"ada"` — two lines
         * each, and a state block of six fields reading as twelve rows of mostly nothing.
         *
         * The `.sv` element stays in both shapes, because it is what the patch path looks up by id and
         * what an editor replaces — only where it sits changes.
         */
        const inline = rendersAsLeaf(value);
        const buttons = `${edit}${this.values.button(vid, value)}`;

        return inline
          ? `<div class="state-row one-line">
              <span class="sk">${escapeHtml(k)}:</span>
              <span class="sv" data-sv="${escapeHtml(vid)}">${renderJsonHtml(value, INLINE)}</span>
              ${buttons}
            </div>`
          : `<div class="state-row">
              <div class="state-head"><span class="sk">${escapeHtml(k)}:</span>${buttons}</div>
              <div class="sv" data-sv="${escapeHtml(vid)}">${renderJsonHtml(value, INLINE)}</div>
            </div>`;
      })
      .join("");
    const titleHtml = title ? `<div class="state-title">${title}</div>` : "";
    return `<div class="state-block">${titleHtml}${rows}</div>`;
  }

  renderComponentsFull() {
    const container = this.root.querySelector("#components-container");
    const inspect = this.inspect;
    if (!container || !inspect) return;

    /**
     * Where the reader was, kept across the rebuild.
     *
     * A structural change — one component mounting anywhere in the app — replaces this whole
     * subtree's markup, and `innerHTML` resets the scroll of its container to the top. So reading
     * a component while the app was doing anything at all threw you back to the root of the tree.
     * The collapsed set does the same job for the disclosures: without it every `<details>` came
     * back open, and a tree the reader had folded down to what they cared about unfolded itself.
     */
    const scroller = this.root.querySelector("#components-tab") as HTMLElement | null;
    const scrollTop = scroller?.scrollTop ?? 0;
    this.syncCollapsed(container);

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
    const acc: WalkAcc = { values: new Map(), raw: new Map(), nodes: new Map(), sig: [] };
    const fullHtml = this.walkTree(tree, "", acc);

    let html = fullHtml;
    let crumbs = "";

    if (this.pinned !== undefined) {
      const found = this.locate(tree, "", this.pinned, []);
      if (found) {
        const sub: WalkAcc = { values: new Map(), raw: new Map(), nodes: new Map(), sig: [] };
        html = this.walkTree([found.node], found.parentPrefix, sub, found.index);
        crumbs = this.renderCrumbs(found.trail, false);
      } else {
        // Unmounted, or a route away. Say so and show the whole tree again rather than an empty
        // panel: the pin is still there to click off, and the reader can see where they are.
        crumbs = this.renderCrumbs([], true);
      }
    }

    const crumbBar = this.root.querySelector("#crumbs");
    if (crumbBar) {
      crumbBar.innerHTML = crumbs;
      crumbBar.classList.toggle("on", crumbs !== "");
    }

    container.innerHTML = html || `<small style="color:var(--rmd-text-faint)">No active components…</small>`;
    this.checkPendingWrite(acc.values);
    this.lastValues = acc.values;
    this.values.publishComponents(acc.raw);
    this.nodeMap = acc.nodes;
    this.elementPaths = new WeakMap();
    for (const [path, node] of acc.nodes) this.elementPaths.set(node, path);
    this.lastSig = acc.sig.join(";");
    this.attachInspectorEvents(container);
    this.applyFilter();
    if (scroller && scrollTop > 0) scroller.scrollTop = scrollTop;
    // Also here, not only on the value-patch path: a STRUCTURAL change is how an open value most
    // often moves or disappears, and `refreshComponents` hands straight over to this method when
    // the signature moved — so a check only there never ran for the case that matters most.
    this.values.mark();
  }

  /**
   * Records which branches are folded, read straight off the DOM about to be replaced.
   *
   * Read rather than listened to, deliberately: `toggle` is dispatched as a QUEUED TASK, so a
   * structural rebuild landing in the same task as the reader's click would replace the markup
   * before the event arrived and the fold would be lost. The elements themselves cannot be out of
   * date. Only the paths currently rendered are touched, so a fold inside a branch that is not on
   * screen — because something else is focused — keeps whatever it had.
   */
  syncCollapsed(container: Element): void {
    for (const details of Array.from(container.querySelectorAll("details"))) {
      const path = details.querySelector(".comp-summary")?.getAttribute("data-path");
      if (!path) continue;
      if ((details as HTMLDetailsElement).open) this.collapsed.delete(path);
      else this.collapsed.add(path);
    }
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

  /**
   * Picking a component by pointing at it on the page — the navigation the tree cannot give you.
   *
   * You almost always know what on SCREEN you care about, and almost never where it sits in the
   * tree. This inverts the search: hover the page, the component under the cursor is outlined and
   * named, and a click focuses it in the panel.
   *
   * Three things make it work, and each is load-bearing:
   *
   * - **The listeners capture on `window`.** Ramonda attaches a handler to its element directly,
   *   in the bubble phase, so capturing before it and stopping propagation is what keeps a pick
   *   from ALSO submitting the form or opening the menu you pointed at.
   * - **The cursor becomes a crosshair.** The only signal that the next click will not reach the
   *   app; a mode you cannot see is a mode you forget you are in.
   */
  setPicking(on: boolean): void {
    if (on === this.picking) return;
    this.picking = on;

    this.host.classList.toggle("picking", on);
    this.root.querySelector('[data-tool="pick"]')?.classList.toggle("on", on);

    const events = ["pointermove", "pointerdown", "pointerup", "click", "keydown"] as const;
    for (const type of events) {
      if (on) window.addEventListener(type, this.onPick, true);
      else window.removeEventListener(type, this.onPick, true);
    }

    if (on) {
      this.previousCursor = document.body.style.cursor;
      document.body.style.cursor = "crosshair";
    } else {
      document.body.style.cursor = this.previousCursor;
      this.clearHighlight();
      this.showPickLabel(undefined, 0, 0);
    }
  }

  private previousCursor = "";

  /**
   * One handler for every pointer event, and it swallows all of them.
   *
   * A field holding an arrow function rather than a method: the same reference has to come back
   * out for `removeEventListener`, and `this.onPick.bind(this)` would produce a new one each time
   * and leave the old listener attached forever.
   */
  private onPick = (event: Event): void => {
    if (!this.picking) return;

    // Anything inside the panel is retargeted to the host element, which is how a hover over the
    // panel itself is told apart from a hover over the page.
    const target = event.target;
    if (target === this.host || (target instanceof Node && this.host.contains(target))) return;

    if (event.type === "keydown") {
      if ((event as KeyboardEvent).key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.setPicking(false);
      return;
    }

    const path = this.pathForElement(target);

    if (event.type === "pointermove") {
      const pointer = event as PointerEvent;
      if (path) this.highlight(path);
      else this.clearHighlight();
      this.showPickLabel(path, pointer.clientX, pointer.clientY);
      return;
    }

    // Every remaining event is a press or a click on the app, and the app must not see it: a pick
    // that also triggers what it pointed at is worse than no picker.
    event.preventDefault();
    event.stopPropagation();

    if (event.type !== "click") return;
    this.setPicking(false);
    if (path) this.pin(path);
  };

  /** The nearest ancestor that IS a component — the cursor is usually over some child element. */
  private pathForElement(target: EventTarget | null): string | undefined {
    let element = target instanceof HTMLElement ? target : null;
    while (element) {
      const path = this.elementPaths.get(element);
      if (path) return path;
      element = element.parentElement;
    }
    return undefined;
  }

  /**
   * The name of what is under the cursor, next to the cursor.
   *
   * It has to be here rather than in the tree, because while picking the reader is looking at the
   * page: a name in a panel they are not reading is a name they do not see. Clamped so it cannot
   * push itself off the bottom-right edge, where the cursor spends much of its time.
   */
  private showPickLabel(path: string | undefined, x: number, y: number): void {
    const label = this.root.querySelector("#pick-label") as HTMLElement | null;
    if (!label) return;

    if (path === undefined) {
      label.classList.remove("on");
      return;
    }

    const name = path.slice(path.lastIndexOf(":") + 1);
    const kind = path.includes(`:hook:${name}`) ? "hook" : "component";
    label.textContent = kind === "hook" ? name : `<${name} />`;
    label.classList.add("on");
    label.style.left = `${Math.min(x + 14, window.innerWidth - label.offsetWidth - 8)}px`;
    label.style.top = `${Math.min(y + 18, window.innerHeight - label.offsetHeight - 8)}px`;
  }

  /**
   * One value, on the whole panel.
   *
   * A snapshot rather than a live view, on purpose: this is opened to READ something carefully,
   * and a tree that re-renders under the cursor while you are three levels into it is unreadable.
   * Close and re-open for the current value.
   *
   * `raw` switches to pretty-printed JSON, which is what you want when the answer is "paste this
   * into a test" rather than "what shape is this".
   */

  /** Focuses one component, or the whole tree when given `undefined`. */
  pin(path: string | undefined): void {
    this.pinned = path;
    writeSession(PIN_KEY, path ?? null);
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
  applyFilter(): void {
    const container = this.root.querySelector("#components-container");
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
  refreshComponents() {
    const container = this.root.querySelector("#components-container");
    const inspect = this.inspect;
    if (!container || !inspect) return;

    const tree = inspect();
    const acc: WalkAcc = { values: new Map(), raw: new Map(), nodes: new Map(), sig: [] };
    this.walkTree(tree, "", acc); // fills acc (html discarded)

    if (acc.sig.join(";") !== this.lastSig) {
      this.renderComponentsFull();
      return;
    }

    for (const [vid, val] of acc.values) {
      if (this.lastValues.get(vid) !== val) {
        // From a MAP, not from `[data-sv="…"]`. A value id carries a prop name, and a prop name
        // can carry a quote — the same shape as the query hash that made `querySelector` throw on
        // every poll. There is no selector here to break.
        const span = this.valueElements.get(vid);
        if (span) {
          span.innerHTML = renderJsonHtml(acc.raw.get(vid), INLINE);
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

    this.checkPendingWrite(acc.values);
    this.lastValues = acc.values;
    this.values.publishComponents(acc.raw);
    this.nodeMap = acc.nodes;
    this.values.mark();
  }

  // Highlight the real DOM node on hover (direct reference — no name matching).
  private attachInspectorEvents(container: Element) {
    this.valueElements = new Map();
    for (const element of Array.from(container.querySelectorAll("[data-sv]"))) {
      this.valueElements.set((element as HTMLElement).dataset.sv ?? "", element as HTMLElement);
    }

    for (const button of Array.from(container.querySelectorAll("[data-full]"))) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.values.openFull((button as HTMLElement).dataset.full ?? "");
      });
    }

    container.querySelectorAll(".comp-summary").forEach((summary) => {
      const path = summary.getAttribute("data-path")!;
      summary.addEventListener("mouseenter", () => this.highlight(path));
      summary.addEventListener("mouseleave", () => this.clearHighlight());
    });

    container.querySelectorAll("[data-edit-node]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.beginEdit(button as HTMLElement);
      });
    });

    container.querySelectorAll("[data-src-file]").forEach((button) => {
      button.addEventListener("click", (event) => {
        // Inside a `<summary>`, so the disclosure's default action has to be stopped — the same
        // reason the focus button does it.
        event.preventDefault();
        event.stopPropagation();
        const element = button as HTMLElement;
        void this.openInEditor(element.dataset.srcFile ?? "", element.dataset.srcLine, element.dataset.srcColumn);
      });
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
   * Highlights the real element, by direct reference rather than by name.
   *
   * It used to fade the panel first, because the panel covered the page it was describing and the
   * highlight was often behind it. The panel docks now, so the app is beside it and there is
   * nothing to get out of the way of. Nothing is unmounted and no layout moves either, which
   * matters: the element being highlighted must not shift because the panel reacted.
   */
  private highlight(path: string) {
    const node = this.nodeMap.get(path);
    if (!node || !(node instanceof HTMLElement)) return;
    this.clearHighlight();
    this.highlighted = node;
    node.dataset.ramondaPrevOutline = node.style.outline;
    node.style.outline = `2px solid ${brand.purple}`;
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
