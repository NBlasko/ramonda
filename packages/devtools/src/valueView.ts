import { escapeHtml, safeStringify } from "./format";
import { FULL, renderJsonHtml, summarize, toPrettyText } from "./jsonView";

/**
 * Reading and editing one value, wherever in the panel it came from.
 *
 * Every tab that shows a value shares this: the components tree shows `@state` and props, the query
 * tab shows a cache entry, and both want the same three things — open it on the whole panel, edit it
 * in place, and say when the app has written a newer one underneath you.
 *
 * ## What it owns
 *
 * The two maps of live values, keyed by value id, and the state of the full view. A tab PUBLISHES
 * into the maps as it renders (`raw.set(id, value)`) and otherwise talks to this through
 * `openFull`, `openEditor` and `button`. Nothing outside reads the maps to render from — they exist
 * so that a value the reader clicks can be found again, and so the full view can re-read the value
 * it is showing rather than the copy it was handed.
 *
 * ## What it does not own
 *
 * The rows. A tab decides what a value looks like inline and where the ⤢ button goes; this decides
 * what happens when it is pressed. That line is what lets the query tab and the components tab
 * disagree about layout while agreeing about values.
 */
export class ValueView {
  /**
   * Component values, keyed `path::slot::key`.
   *
   * Handed over whole by `publishComponents` rather than written into, because the components tab
   * rebuilds the entire set on a structural render and a stale id must not survive it.
   */
  private components = new Map<string, unknown>();

  /**
   * Plugin values, keyed `p::panel::row`, written into as rows render.
   *
   * A separate map, and that is the point: the components map is replaced wholesale, so sharing one
   * meant that switching to the Components tab with a query value open reported it as gone, which
   * it was not.
   */
  readonly plugins = new Map<string, unknown>();

  private value: unknown;
  private rawMode = false;
  /** Which value the full view is showing, so it can be re-read on demand. */
  private id: string | undefined;
  /** The one-line form of what it is showing, which is what "has it changed" compares against. */
  private signature = "";

  constructor(private readonly root: ShadowRoot) {}

  /**
   * Wires the full view's own controls. Called once, after the panel's HTML exists.
   *
   * Separate from the constructor because the modal's buttons are in that HTML: constructing this
   * before `render()` and binding after it keeps the field available to everything in between.
   */
  bind(): void {
    this.root.querySelector("#jv-close")?.addEventListener("click", () => this.close());

    this.root.querySelector("#jv-refresh")?.addEventListener("click", () => {
      if (this.id === undefined) return;
      const current = this.byId(this.id);
      if (current === undefined) return;
      this.value = current;
      this.signature = safeStringify(current);
      this.paint();
      this.mark(false);
    });

    this.root.querySelector("#jv-raw")?.addEventListener("click", (event) => {
      this.rawMode = !this.rawMode;
      (event.currentTarget as HTMLElement).classList.toggle("on", this.rawMode);
      this.paint();
    });

    this.root.querySelector("#jv-copy")?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLElement;
      const text = toPrettyText(this.value);
      try {
        // Absent on http:// and when the document is not focused, which is common enough here that
        // failing silently would look like the button doing nothing.
        await navigator.clipboard.writeText(text);
        button.textContent = "copied";
      } catch {
        button.textContent = "cannot copy";
      }
      setTimeout(() => {
        button.textContent = "copy";
      }, 1200);
    });
  }

  /** Replaces every component value at once — see the field for why it is not written into. */
  publishComponents(values: Map<string, unknown>): void {
    this.components = values;
  }

  /**
   * A value id is either a component's `path::slot::key` or a plugin's `p::panel::row`.
   *
   * The prefix picks the map, and that is what keeps a plugin's value readable while the Components
   * tab is open: the component map is replaced wholesale on a structural render, so a plugin value
   * living in it would be reported as gone the moment the reader switched tabs.
   */
  byId(id: string): unknown {
    return id.startsWith("p::") ? this.plugins.get(id) : this.components.get(id);
  }

  get isOpen(): boolean {
    return this.root.querySelector("#jv-modal")?.classList.contains("on") === true;
  }

  openFull(id: string): void {
    const value = this.byId(id);
    if (value === undefined) return;

    this.id = id;
    this.value = value;
    this.signature = safeStringify(value);
    this.rawMode = false;

    (this.root.querySelector("#jv-raw") as HTMLElement).classList.remove("on");
    this.paint();
    this.root.querySelector("#jv-modal")!.classList.add("on");
    this.mark(false);
  }

  close(): void {
    this.root.querySelector("#jv-modal")?.classList.remove("on");
    this.value = undefined;
    this.id = undefined;
  }

  /**
   * Notices that the app wrote a different value while the full view was open.
   *
   * Compared as one line rather than by identity: structural sharing hands back the SAME object
   * when an answer did not change, so identity alone would be enough for a query — but a component
   * has no such guarantee, and a rebuilt-but-equal object must not light the button. The reader
   * asked for "tell me it moved, and let me choose when to look", and that is a comparison of
   * contents.
   */
  mark(check = true): void {
    const button = this.root.querySelector("#jv-refresh") as HTMLElement | null;
    if (!button || this.id === undefined) return;

    if (!check) {
      button.classList.remove("stale", "gone");
      button.title = "the value has not changed";
      return;
    }

    const current = this.byId(this.id);
    if (current === undefined) {
      // Unmounted, or collected out of the cache. There is nothing to refresh TO, and pretending
      // otherwise would replace the value being read with an empty tree.
      button.classList.remove("stale");
      button.classList.add("gone");
      button.title = "the value is no longer there — this is the last snapshot of it";
      return;
    }

    const stale = safeStringify(current) !== this.signature;
    button.classList.toggle("stale", stale);
    button.classList.remove("gone");
    button.title = stale ? "the app wrote a new value — click to show it" : "the value has not changed";
  }

  /**
   * The button that opens one value on the whole panel.
   *
   * Only for a value with something to open. A number does not need a full view, and a button
   * that opens a bigger box containing `3` is noise on every row.
   */
  button(id: string, value: unknown): string {
    const container = Array.isArray(value) || (typeof value === "object" && value !== null);
    if (!container) return "";
    return `<button type="button" class="jv-open" data-full="${escapeHtml(id)}" title="open ${escapeHtml(
      summarize(value),
    )} in the full view">⤢</button>`;
  }

  /**
   * Turns a value's box into an input, and hands what was typed to `commit`.
   *
   * `commit` returns `undefined` when the write was taken, or a sentence saying why it was refused —
   * so the caller decides what is writable without this needing to know whether it is looking at
   * `@state`, a query's data, or something else.
   */
  openEditor(box: HTMLElement, value: unknown, commit: (parsed: unknown) => string | undefined): void {
    if (box.querySelector(".edit-input")) return;

    const current = toPrettyText(value);
    const multiline = current.includes("\n") || current.length > 60;
    const field = document.createElement(multiline ? "textarea" : "input");
    field.className = "edit-input";
    field.value = current;
    if (field instanceof HTMLTextAreaElement) field.rows = Math.min(12, current.split("\n").length + 1);

    const note = document.createElement("div");
    note.className = "edit-note";
    note.textContent = multiline ? "⌘/Ctrl+Enter to apply · Esc to cancel" : "Enter to apply · Esc to cancel";

    const previous = box.innerHTML;
    box.innerHTML = "";
    box.append(field, note);
    field.focus();
    field.select();

    const cancel = () => {
      box.innerHTML = previous;
    };

    const apply = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(field.value);
      } catch {
        note.textContent = "not valid JSON — a string needs quotes";
        note.classList.add("bad");
        return;
      }

      const refusal = commit(parsed);
      if (refusal === undefined) {
        // Not repainted here: the write wakes whoever was watching, and the ordinary refresh redraws
        // this row with the value the app actually holds — the only value worth showing.
        cancel();
        return;
      }

      note.textContent = refusal;
      note.classList.add("bad");
    };

    field.addEventListener("keydown", (raw: Event) => {
      const event = raw as KeyboardEvent;
      // Contained, so the panel's own Escape handling does not release the focused component while
      // the reader only meant to abandon an edit.
      event.stopPropagation();

      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (event.key !== "Enter") return;
      if (multiline && !event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      apply();
    });

    field.addEventListener("blur", () => {
      // Abandoned rather than applied: a value half-typed and clicked away from is not an intention.
      if (box.contains(field)) cancel();
    });
  }

  private paint(): void {
    // The title carries the size, so it is painted with the body — a refresh that brought two more
    // pages has to stop saying Array(2).
    const title = this.root.querySelector("#jv-modal-title") as HTMLElement;
    const id = this.id ?? "";
    title.textContent = `${id.slice(id.lastIndexOf("::") + 2)} — ${summarize(this.value)}`;

    const body = this.root.querySelector("#jv-modal-body") as HTMLElement;
    body.innerHTML = this.rawMode
      ? `<pre class="jv-raw">${escapeHtml(toPrettyText(this.value))}</pre>`
      : renderJsonHtml(this.value, FULL);
  }
}
