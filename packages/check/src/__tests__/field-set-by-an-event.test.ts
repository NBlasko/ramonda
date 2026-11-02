import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "field-set-by-an-event");
const found = () => analyzeProject(join(fixture, "tsconfig.json")).findings["field-set-by-an-event"] ?? [];
const source = readFileSync(join(fixture, "app.tsx"), "utf8").split("\n");

/**
 * A field given an edit by the work a commit runs. The field learns its model through render, and
 * the render that edit's handler causes comes once the commit is over — so what the field shows is
 * written as state, and an edit that must go through the field is sent after the commit.
 */
describe("a field set by an event while a commit runs", () => {
  /** Every line the fixture marks `// REPORT`, and no other — each class is one shape. */
  test("every marked line is reported once, and nothing else", () => {
    const marked = source.flatMap((line, i) => (line.includes("// REPORT") ? [i + 1] : []));
    expect(
      found()
        .map((issue) => issue.line)
        .sort((a, b) => a - b),
    ).toEqual(marked);
  });

  test("each is named for what it does and where the commit reached it from", () => {
    const by = (component: string) =>
      found()
        .filter((issue) => issue.component === component)
        .map(({ kind, detail, from }) => `${kind} ${detail} ← ${from}`);
    expect(by("ClicksABoxOnMount")).toEqual(["click this.box ← @mounted start"]);
    expect(by("DispatchesInputOnUpdate")).toEqual(["dispatch input ← @updated again"]);
    expect(by("WritesTheValueInAHelper")).toEqual(["write this.field.value ← @mounted start"]);
    expect(by("ClicksALabel")).toEqual(["click this.label ← @mounted start"]);
    expect(by("DispatchesAnUnreadableEvent")).toEqual(["unreadable new Event(kind) ← @mounted start"]);
    expect(by("EditsTheFocusedField")).toEqual(["exec-command execCommand ← @mounted start"]);
    // A ref's callback, wherever the ref is made — a field, or the constructor — runs as its element attaches.
    expect(by("ClicksThroughABoundRef")).toEqual([
      "click node ← the ref callback of this.box",
      "click node ← the ref callback of this.other",
      "click node ← the ref callback of this.local",
    ]);
    expect(by("LocalDocumentAndARenamedRef")).toEqual(["click node ← the ref callback of this.box"]);
    expect(by("EditsFromEveryCommitHook")).toEqual([
      "dispatch change ← the constructor",
      "dispatch beforeinput ← @created made",
      "dispatch compositionend ← @destroyed gone",
      "dispatch compositionstart ← @watchProp moved",
      "dispatch input ← render",
    ]);
  });

  /**
   * An event handler is not a commit's work: a row whose `onclick` clicks its checkbox does what a
   * `<label>` does. Nor is what runs after the commit — a microtask, a timer, a promise, past an
   * `await` — nor a click that is a command: a button, a file input's picker, a label of a text
   * field. Nor an event dispatched where no field hears it: the document, a store.
   */
  test("a handler, what runs after the commit, and a command are not reported", () => {
    const components = new Set(found().map((issue) => issue.component));
    for (const allowed of [
      "ClicksFromAHandler",
      "ClicksAfterTheCommit",
      "ClicksAButtonAndAFileInput",
      "AnnouncesItself",
      "WritesAnUncontrolledField",
      "FocusesOnMount",
      "DispatchesAtTheDocument",
      "TellsAStore",
      "HandlersWrittenInline",
      "ClicksALabelOfATextField",
      "HandlerHeldInALocal",
      "DispatchesAHeldFocus",
    ]) {
      expect(components.has(allowed), allowed).toBe(false);
    }
  });
});
