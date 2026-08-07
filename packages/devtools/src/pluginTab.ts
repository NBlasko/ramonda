import { escapeHtml } from "./format";
import { INLINE, renderJsonHtml } from "./jsonView";
import type { PanelPlugin, PanelRow, PanelSnapshot, RowStatus, RowValue } from "./panelPlugin";
import type { ValueView } from "./valueView";
import { icon } from "@ramonda/theme";

/**
 * Renders one plugin's rows, and is the only place that knows what a row LOOKS like.
 *
 * Every tab described by `PanelPlugin` goes through this: the query cache today, a router table or
 * a socket pool tomorrow. That is the point of the split — a source says what it has and this
 * decides how it reads, so the panel stays one tool rather than a frame around several.
 *
 * ## The two-pass render, which is why a live field has an id
 *
 * The list is rebuilt only when its SHAPE changes — every part of every row except the `live`
 * fields. Those are written straight into their own text nodes on every poll.
 *
 * Without that split the tab rewrote itself twice a second forever, because "updated 12s ago"
 * differs on almost every tick while nothing about the cache has moved. An `innerHTML` write
 * destroys and rebuilds every row, which resets hover, text selection and focus, and repaints. The
 * shape decides whether to rebuild; the clock never does.
 */
export class PluginTab {
  /** The last rendered shape — see the note above. */
  private shape = "";

  constructor(
    private readonly root: ShadowRoot,
    private readonly values: ValueView,
    private readonly toast: (message: string) => void,
  ) {}

  /** The container this plugin's rows live in. Ids are derived from the plugin id, never a title. */
  private container(plugin: PanelPlugin): Element | null {
    return this.root.querySelector(`#plugin-${plugin.id}-container`);
  }

  render(plugin: PanelPlugin): void {
    const container = this.container(plugin);
    if (!container) return;

    // Nothing is rebuilt under an open editor. The poll is twice a second and any event in the
    // source rebuilds this list, so without this the box would vanish mid-sentence.
    if (container.querySelector(".edit-input")) return;

    let snapshot: PanelSnapshot;
    try {
      snapshot = plugin.snapshot();
    } catch (error) {
      // A source that throws must not take the panel with it — the reader is most likely here
      // BECAUSE something is wrong.
      this.write(
        container,
        `<small style="color:var(--rmd-error-text)">${escapeHtml(plugin.label)} could not be read.</small>`,
      );
      // eslint-disable-next-line no-console
      // Not a diagnostic code: the fault is in a plugin this panel does not own, so the useful
      // thing is the plugin's id and its error, and there is no advice of ours to attach. This
      // package raises no codes at all — it is the collector, not a reporter.
      console.error(`[ramonda-devtools] ${plugin.id}.snapshot() threw`, error);
      return;
    }

    const rows = snapshot.groups.flatMap((group) => group.rows);
    if (rows.length === 0) {
      this.write(
        container,
        `<small style="color:var(--rmd-text-faint)">${escapeHtml(snapshot.empty ?? "Nothing here yet.")}</small>`,
      );
      return;
    }

    const shape = shapeOf(snapshot);
    if (shape === this.shape) {
      this.refreshLive(container, rows);
      return;
    }
    this.shape = shape;

    let html = "";
    for (const group of snapshot.groups) {
      if (group.label !== undefined) html += `<div class="q-client">${escapeHtml(group.label)}</div>`;
      for (const row of group.rows) html += this.renderRow(plugin, row);
    }

    container.innerHTML = html;
    this.bind(plugin, container, rows);
    this.values.mark();
  }

  /** Drops the remembered shape, so the next render rebuilds rather than comparing. */
  reset(): void {
    this.shape = "";
  }

  private write(container: Element, html: string): void {
    if (this.shape === html) return;
    this.shape = html;
    container.innerHTML = html;
  }

  /**
   * Updates just the live fields, by id, leaving every node in place.
   *
   * Matched in JS through `dataset`, never by an attribute SELECTOR built from an id. A row id can
   * carry anything the source put in it — a query's is a JSON key, quotes and brackets included —
   * and interpolating that into `[data-live="…"]` produces a selector the parser rejects. It threw
   * on every poll, four times a second, which is exactly what an idle panel must not do.
   */
  private refreshLive(container: Element, rows: PanelRow[]): void {
    const nodes = new Map<string, Element>();
    for (const element of Array.from(container.querySelectorAll("[data-live]"))) {
      nodes.set((element as HTMLElement).dataset.live ?? "", element);
    }

    for (const row of rows) {
      for (const field of row.fields ?? []) {
        if (field.kind !== "live") continue;
        const node = nodes.get(`${row.id}::${field.id}`);
        if (node && node.textContent !== field.text) node.textContent = field.text;
      }
    }
  }

  private renderRow(plugin: PanelPlugin, row: PanelRow): string {
    const valueId = `p::${plugin.id}::${row.id}`;
    const title = row.code ? `<code class="q-key">${escapeHtml(row.title)}</code>` : escapeHtml(row.title);

    const badges = (row.fields ?? [])
      .filter((field) => field.kind === "badge")
      .map((field) =>
        field.kind === "badge"
          ? `<span class="${field.tone === "warn" ? "q-fetching" : "q-badge"}">${escapeHtml(field.text)}</span>`
          : "",
      )
      .join("");

    const meta = (row.fields ?? [])
      .filter((field) => field.kind !== "badge")
      .map((field) =>
        field.kind === "live"
          ? `<span data-live="${escapeHtml(`${row.id}::${field.id}`)}">${escapeHtml(field.text)}</span>`
          : escapeHtml(field.kind === "text" ? field.text : ""),
      )
      .join(" · ");

    const actions = (row.actions ?? [])
      .map(
        (action) =>
          `<button type="button" data-p-action="${escapeHtml(action.id)}" data-p-row="${escapeHtml(row.id)}"${
            action.title ? ` title="${escapeHtml(action.title)}"` : ""
          }>${escapeHtml(action.label)}</button>`,
      )
      .join("");

    return `
      <div class="q-row">
        <div class="q-head">
          ${row.status ? `<span class="q-status" style="background:${statusColour(row.status)}"></span>` : ""}
          ${title}
          ${row.value?.editable ? editButton(row.id) : ""}
          ${row.value ? this.values.button(valueId, row.value.data) : ""}
          ${badges}
        </div>
        ${meta ? `<div class="q-meta">${meta}</div>` : ""}
        ${row.error ? `<div class="q-error">${escapeHtml(row.error)}</div>` : ""}
        ${row.value ? `<div class="q-data" data-p-value="${escapeHtml(row.id)}">${valueHtml(row.value)}</div>` : ""}
        ${actions ? `<div class="q-actions">${actions}</div>` : ""}
      </div>`;
  }

  private bind(plugin: PanelPlugin, container: Element, rows: PanelRow[]): void {
    const byId = new Map(rows.map((row) => [row.id, row]));

    // The rows are rebuilt whenever the source moves, so the values behind their full-view buttons
    // are re-registered here rather than kept from the last render.
    for (const row of rows) {
      if (row.value) this.values.plugins.set(`p::${plugin.id}::${row.id}`, row.value.data);
    }

    for (const button of Array.from(container.querySelectorAll("[data-full]"))) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.values.openFull((button as HTMLElement).dataset.full ?? "");
      });
    }

    for (const button of Array.from(container.querySelectorAll("[data-p-edit]"))) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.beginEdit(container, byId.get((button as HTMLElement).dataset.pEdit ?? ""));
      });
    }

    for (const button of Array.from(container.querySelectorAll("[data-p-action]"))) {
      button.addEventListener("click", () => {
        const element = button as HTMLElement;
        const message = plugin.run?.(element.dataset.pRow ?? "", element.dataset.pAction ?? "");
        if (message) this.toast(message);
        this.render(plugin);
      });
    }
  }

  private beginEdit(container: Element, row: PanelRow | undefined): void {
    const write = row?.value?.write;
    if (!row || !write) return;

    // Found by matching `dataset` in JS, for the same reason `refreshLive` does.
    const target = Array.from(container.querySelectorAll("[data-p-value]")).find(
      (element) => (element as HTMLElement).dataset.pValue === row.id,
    ) as HTMLElement | undefined;
    if (!target) return;

    this.values.openEditor(target, row.value?.data, (parsed) => {
      const refusal = write(parsed);
      if (refusal !== undefined) return refusal;
      const note = row.value?.writeNote;
      this.toast(note ? `wrote ${row.title} — ${note}` : `wrote ${row.title}`);
      return undefined;
    });
  }
}

/** The tree when there is a value, the source's own one-line summary when there is not. */
function valueHtml(value: RowValue): string {
  if (value.data === undefined && value.preview !== undefined) return escapeHtml(value.preview);
  return renderJsonHtml(value.data, INLINE);
}

function statusColour(status: RowStatus): string {
  if (status === "error") return "var(--rmd-error)";
  if (status === "ok") return "var(--rmd-ok)";
  if (status === "busy") return "var(--rmd-warn)";
  return "var(--rmd-text-faint)";
}

function editButton(rowId: string): string {
  return `<button type="button" class="edit-btn" data-p-edit="${escapeHtml(
    rowId,
  )}" title="edit this value — it is what the page renders from">${icon("edit")}</button>`;
}

/**
 * Everything about a snapshot EXCEPT its live fields.
 *
 * A live field is expected to differ on most polls, so including it would rebuild the list every
 * time — which is the flicker this whole two-pass render exists to avoid.
 */
function shapeOf(snapshot: PanelSnapshot): string {
  return snapshot.groups
    .flatMap((group) => [
      group.label ?? "",
      ...group.rows.map((row) =>
        [
          row.id,
          row.title,
          row.status ?? "",
          row.error ?? "",
          row.value?.editable ? "e" : "",
          (row.actions ?? []).map((action) => action.id).join(","),
          (row.fields ?? [])
            .filter((field) => field.kind !== "live")
            .map((field) => field.text)
            .join("|"),
          // `revision` when the source has one, because it is the only answer that cannot be
          // fooled: a value can change without its shape doing so. Falls back to the shape, which
          // is what the collapsed row shows anyway.
          row.value?.revision ?? summarizeValue(row.value?.data),
        ].join(""),
      ),
    ])
    .join("\n");
}

/**
 * A cheap stand-in for "has this value moved".
 *
 * `JSON.stringify` over a large cached payload on every poll would be the most expensive thing the
 * panel does, so this reads the shape rather than the contents — which is exactly what the row
 * shows anyway, since a container renders as a collapsed summary until it is opened.
 */
function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `a${value.length}`;
  if (typeof value === "object") return `o${Object.keys(value as object).length}`;
  return String(value);
}
