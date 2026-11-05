import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component, Select } from "../index";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import { componentAt } from "../core/DiffAndMerge";
import { flushSync } from "../testing";

/**
 * Every case of a `defaultValue` select at once, against its one rule:
 *
 * - a pick stays — made by an event, by a script, or on a served page before the script arrived;
 * - a reset shows the default, and so does a pick whose options are all gone;
 * - untouched, the select shows its default, wherever the default moves;
 * - a served page and a built one end the same.
 *
 * One table, rather than a test per shape: the review rounds found these one shape at a time, and each
 * fix of one shape broke the next.
 */

type Origin = "built" | "served";
type Kind = "single" | "multiple" | "listbox";
type Pick = "none" | "event" | "script" | "before";
type Then =
  | "nothing"
  | "default-moves"
  | "reset"
  | "reset-then-default-moves"
  | "pick-removed"
  | "replaced-keeping-default"
  | "replaced-all";

const FIRST = ["a", "b", "c"];
/** The pick's option goes, and nothing comes. */
const WITHOUT_PICK = ["b", "c"];
/** The pick's option goes; the default's stays, as the same element. */
const KEEPING_DEFAULT = ["d", "b", "e"];
/** Every option goes, and the default with them: the new default is one of the new options. */
const ALL_NEW = ["d", "e", "f"];

class Harness extends Component<{ kind: Kind }> {
  @state saved = "b";
  @state list = FIRST;
  @state renders = 0;
  render() {
    const multiple = this.props.kind === "multiple";
    return (
      <form>
        <output>{this.renders}</output>
        <Select
          aria-label="Case"
          multiple={multiple}
          size={this.props.kind === "listbox" ? 3 : undefined}
          defaultValue={multiple ? [this.saved] : this.saved}
        >
          {this.list.map(optionOf)}
        </Select>
      </form>
    );
  }
}

function optionOf(value: string) {
  return (
    <option key={value} value={value}>
      {value}
    </option>
  );
}

const chosen = (select: HTMLSelectElement) => Array.from(select.selectedOptions, (o) => o.value);

/** The user (or a script) chooses `a` alone: in a `multiple` select, the default `b` is taken off too. */
function choose(select: HTMLSelectElement): void {
  for (const option of Array.from(select.options)) {
    if (option.value === "a") option.selected = true;
    else if (option.selected) option.selected = false;
  }
}

/** What the rule says the select shows at the end. */
function expected(pick: Pick, then: Then): string[] {
  const picked = pick !== "none";
  switch (then) {
    case "nothing":
      return picked ? ["a"] : ["b"];
    case "default-moves":
      return picked ? ["a"] : ["c"];
    case "reset":
      return ["b"];
    case "reset-then-default-moves":
      return ["c"];
    case "pick-removed":
    case "replaced-keeping-default":
      return ["b"];
    case "replaced-all":
      return ["e"];
  }
}

async function run(origin: Origin, kind: Kind, pick: Pick, then: Then): Promise<string[]> {
  let harness: Harness;
  let select: HTMLSelectElement;
  let settle: () => void;
  let done: () => void;

  if (origin === "built") {
    const app = await getDOM<Harness>(<Harness kind={kind} />);
    await app.settle();
    harness = app.instance;
    select = app.container.querySelector("select") as HTMLSelectElement;
    settle = () => flushSync();
    done = () => {};
  } else {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Harness kind={kind} />);
    select = container.querySelector("select") as HTMLSelectElement;
    if (pick === "before") choose(select);
    hydrateRoot(<Harness kind={kind} />, container);
    await Promise.resolve();
    await Promise.resolve();
    harness = componentAt(container.querySelector("form") as Element) as Harness;
    settle = () => flushSync();
    done = () => {
      container.remove();
    };
  }

  if (pick === "event") {
    choose(select);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    settle();
  } else if (pick === "script") {
    choose(select);
    harness.renders++;
    settle();
  }

  const form = select.form as HTMLFormElement;
  switch (then) {
    case "nothing":
      harness.renders++;
      settle();
      break;
    case "default-moves":
      harness.saved = "c";
      settle();
      break;
    case "reset":
      form.reset();
      harness.renders++;
      settle();
      break;
    case "reset-then-default-moves":
      form.reset();
      harness.renders++;
      settle();
      harness.saved = "c";
      settle();
      break;
    case "pick-removed":
      harness.list = WITHOUT_PICK;
      settle();
      break;
    case "replaced-keeping-default":
      harness.list = KEEPING_DEFAULT;
      settle();
      break;
    case "replaced-all":
      harness.list = ALL_NEW;
      harness.saved = "e";
      settle();
      break;
  }
  const shown = chosen(select);
  done();
  return shown;
}

const ORIGINS: Origin[] = ["built", "served"];
const KINDS: Kind[] = ["single", "multiple", "listbox"];
const PICKS: Pick[] = ["none", "event", "script", "before"];
const THENS: Then[] = [
  "nothing",
  "default-moves",
  "reset",
  "reset-then-default-moves",
  "pick-removed",
  "replaced-keeping-default",
  "replaced-all",
];

describe("a defaultValue select, every case", () => {
  test("ends where the rule says, in every case", async () => {
    const wrong: string[] = [];
    let cases = 0;
    for (const origin of ORIGINS) {
      for (const kind of KINDS) {
        for (const pick of PICKS) {
          // A pick before the script exists only on a served page.
          if (pick === "before" && origin === "built") continue;
          for (const then of THENS) {
            cases++;
            const shown = await run(origin, kind, pick, then);
            const wanted = expected(pick, then);
            if (shown.join() !== wanted.join()) {
              wrong.push(`${origin} ${kind}, pick ${pick}, then ${then}: shows [${shown}], wants [${wanted}]`);
            }
          }
        }
      }
    }
    expect({ cases, wrong }).toEqual({ cases: 147, wrong: [] });
  });
});
