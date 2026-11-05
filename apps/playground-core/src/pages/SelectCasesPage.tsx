import { Component, Select, bootstrap, hydrateRoot, renderToString, state, unmount } from "@ramonda/core";

/**
 * Every case of a `defaultValue` select, run in this browser — the table core's
 * `DefaultSelectCases.test.tsx` runs in jsdom, which chooses differently from a browser when options
 * come and go. The rule, in each case:
 *
 * - a pick stays — made by an event, by a script, or on a served page before the script arrived;
 * - a reset shows the default, and so does a pick whose options are all gone;
 * - untouched, the select shows its default, wherever the default moves;
 * - a served page and a built one end the same.
 *
 * "Run" lists the cases that end elsewhere; `[]` is the answer `browser/fields.spec.ts` waits for. A
 * button rather than `@mounted`, since each case sends its select the events a reader would.
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
const WITHOUT_PICK = ["b", "c"];
const KEEPING_DEFAULT = ["d", "b", "e"];
const ALL_NEW = ["d", "e", "f"];

/**
 * Each harness this case made, in order: the last one is the one a hydration just built. Emptied as
 * each case starts, so the page keeps no case after it ends.
 */
const made: Harness[] = [];

function register(harness: Harness): true {
  made.push(harness);
  return true;
}

class Harness extends Component<{ kind: Kind }> {
  @state saved = "b";
  @state list = FIRST;
  @state renders = 0;
  private readonly registered = register(this);

  render() {
    const multiple = this.props.kind === "multiple";
    return (
      <form>
        <output aria-label="Renders" data-renders={this.renders} />
        <Select
          aria-label="Case"
          multiple={multiple}
          size={this.props.kind === "listbox" ? 3 : undefined}
          defaultValue={multiple ? [this.saved] : this.saved}
        >
          {this.list.map(optionOf)}
        </Select>
        <button type="reset">Reset</button>
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

/** Every render a change scheduled has run by the next task: renders drain in microtasks. */
function settled(): Promise<void> {
  return new Promise(nextTask);
}

function nextTask(done: () => void): void {
  setTimeout(done, 0);
}

function chosen(select: HTMLSelectElement): string[] {
  return Array.from(select.selectedOptions, valueOf);
}

function valueOf(option: HTMLOptionElement): string {
  return option.value;
}

/** The user (or a script) chooses `a` alone: in a `multiple` select, the default `b` is taken off too. */
function choose(select: HTMLSelectElement): void {
  for (const option of Array.from(select.options)) {
    if (option.value === "a") option.selected = true;
    else if (option.selected) option.selected = false;
  }
}

function expected(pick: Pick, then: Then): string[] {
  const picked = pick !== "none";
  switch (then) {
    case "nothing":
      return picked ? ["a"] : ["b"];
    case "default-moves":
      return picked ? ["a"] : ["c"];
    case "reset":
    case "pick-removed":
    case "replaced-keeping-default":
      return ["b"];
    case "reset-then-default-moves":
      return ["c"];
    case "replaced-all":
      return ["e"];
  }
}

async function run(origin: Origin, kind: Kind, pick: Pick, then: Then): Promise<string[]> {
  made.length = 0;
  const container = document.createElement("div");
  document.body.appendChild(container);
  if (origin === "built") {
    bootstrap(<Harness kind={kind} />, container);
  } else {
    container.innerHTML = await renderToString(<Harness kind={kind} />);
    if (pick === "before") choose(container.querySelector("select") as HTMLSelectElement);
    hydrateRoot(<Harness kind={kind} />, container);
  }
  await settled();
  const harness = made[made.length - 1];
  const select = container.querySelector("select") as HTMLSelectElement;

  if (pick === "event") {
    choose(select);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();
  } else if (pick === "script") {
    choose(select);
    harness.renders++;
    await settled();
  }

  // The reader's reset: the form's own button.
  const reset = (select.form as HTMLFormElement).querySelector("button") as HTMLButtonElement;
  if (then === "nothing") harness.renders++;
  else if (then === "default-moves") harness.saved = "c";
  else if (then === "reset" || then === "reset-then-default-moves") {
    reset.click();
    harness.renders++;
    if (then === "reset-then-default-moves") {
      await settled();
      harness.saved = "c";
    }
  } else if (then === "pick-removed") harness.list = WITHOUT_PICK;
  else if (then === "replaced-keeping-default") harness.list = KEEPING_DEFAULT;
  else {
    harness.list = ALL_NEW;
    harness.saved = "e";
  }
  await settled();

  const shown = chosen(select);
  unmount(container);
  container.remove();
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

export class SelectCasesPage extends Component {
  @state cases = 0;
  @state wrong: string[] | undefined;
  @state failure = "";

  async runAll() {
    try {
      await this.everyCase();
    } catch (error) {
      this.failure = String(error);
    }
  }

  private async everyCase() {
    const wrong: string[] = [];
    let cases = 0;
    for (const origin of ORIGINS) {
      for (const kind of KINDS) {
        for (const pick of PICKS) {
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
    this.cases = cases;
    this.wrong = wrong;
  }

  render() {
    return (
      <div className="page">
        <h2>Every default select case</h2>
        <p className="muted">
          Each case of a <code>defaultValue</code> select, run in this browser. The list holds the cases that end where
          the rule does not say.
        </p>
        <button id="run" type="button" onclick={this.runAll}>
          Run
        </button>
        <pre id="select-cases" data-cases={this.cases}>
          {this.failure !== ""
            ? this.failure
            : this.wrong === undefined
              ? "not run"
              : JSON.stringify(this.wrong, null, 2)}
        </pre>
      </div>
    );
  }
}
