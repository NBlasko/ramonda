import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";
import { list } from "../base/list";

/**
 * What a row is holding while the list around it changes — and what the user loses.
 *
 * A row keeps two kinds of state and only one of them is the framework's. `@state` lives on the
 * instance and the record protects it. The other kind lives on the DOM node itself: the text typed
 * into an uncontrolled input and not yet submitted, where the caret is, and whether the field has
 * focus. Nothing in the record knows about any of that. It survives exactly as long as the NODE
 * survives, and no test said so — the stake was named in comments (`HoleAlignment`,
 * `ListRefetchIdentity`) and asserted nowhere.
 *
 * So this asserts the node, and through it the things a person would notice losing.
 *
 * Measured in jsdom, which is what the suite runs in. The one platform fact leaned on is that moving
 * an attached node blurs it — `insertBefore` on a node already in the document removes and reinserts
 * it, and an element removed from the document loses focus. jsdom does that, and so do browsers.
 */

interface Task {
  id: string;
  label: string;
}

class Row extends Component<{ task: Task }> {
  @state clicks = 0;
  bump() {
    this.clicks++;
  }
  render() {
    return (
      <li id={`row-${this.props.task.id}`}>
        <input id={`in-${this.props.task.id}`} />
        <button id={`bump-${this.props.task.id}`} onclick={this.bump}>
          {String(this.clicks)}
        </button>
      </li>
    );
  }
}

class Board extends Component {
  @state tasks: Task[] = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ];
  row = (task: Task) => <Row task={task} key={task.id} />;
  render() {
    return <ul id="board">{list(this.tasks, this.row)}</ul>;
  }
}

/** A board whose rows carry no key, so `list()` matches them by the item objects themselves. */
class Unkeyed extends Board {
  override row = (task: Task) => <Row task={task} />;
}

/** Puts the user in the middle row: focused, mid-word, with the row's own state moved too. */
async function userIsTypingInB(app: Awaited<ReturnType<typeof getDOM<Board>>>) {
  const input = app.container.querySelector("#in-b") as HTMLInputElement;
  input.focus();
  input.value = "half typed";
  input.setSelectionRange(4, 4);
  (app.container.querySelector("#bump-b") as HTMLElement).click();
  await app.settle();
  return input;
}

const rowOrder = (app: { container: HTMLElement }) =>
  [...app.container.querySelectorAll("li")].map((li) => li.id).join(",");

describe("a row keeps what the user typed", () => {
  test("when a LATER row is removed", async () => {
    const app = await getDOM<Board>(<Board />);
    await app.settle();
    const input = await userIsTypingInB(app);

    app.instance.tasks = app.instance.tasks.filter((task) => task.id !== "c");
    await app.settle();

    expect(rowOrder(app)).toBe("row-a,row-b");
    expect(app.container.querySelector("#in-b")).toBe(input);
    expect(input.value).toBe("half typed");
    expect(input.selectionStart).toBe(4);
    expect(document.activeElement).toBe(input);
    expect(app.container.querySelector("#bump-b")!.textContent).toBe("1");
  });

  test("when an EARLIER row is removed, because its own node does not move", async () => {
    /**
     * The row's POSITION changes — it is first now — and its node does not.
     *
     * TWO guards make that true, and it took planting both to find out which: `reorderChildren`
     * returns early when the DOM already reads like the target, and when it does not, `keptInOrder`
     * leaves the longest run of already-ordered nodes alone. Defeating either one on its own changes
     * nothing here, because the other still covers it; defeating both moves `b` and blurs the field.
     *
     * So this is a speed optimisation being credited with something else: it decides how often a
     * person loses the cursor. Moving `b` and `c` up would have been correct output.
     */
    const app = await getDOM<Board>(<Board />);
    await app.settle();
    const input = await userIsTypingInB(app);

    app.instance.tasks = app.instance.tasks.filter((task) => task.id !== "a");
    await app.settle();

    expect(rowOrder(app)).toBe("row-b,row-c");
    expect(app.container.querySelector("#in-b")).toBe(input);
    expect(input.value).toBe("half typed");
    expect(document.activeElement).toBe(input);
  });

  test("when the list is reordered around it", async () => {
    const app = await getDOM<Board>(<Board />);
    await app.settle();
    const input = await userIsTypingInB(app);

    // `a` and `b` trade places: `a` is the one that moves, not `b`.
    app.instance.tasks = [app.instance.tasks[1]!, app.instance.tasks[0]!, app.instance.tasks[2]!];
    await app.settle();

    expect(rowOrder(app)).toBe("row-b,row-a,row-c");
    expect(app.container.querySelector("#in-b")).toBe(input);
    expect(input.value).toBe("half typed");
    expect(input.selectionStart).toBe(4);
    expect(app.container.querySelector("#bump-b")!.textContent).toBe("1");
  });

  test("and across a refetch that replaces every object", async () => {
    /**
     * A `JSON.parse` of a response hands over objects nothing has seen. The `key` is what carries
     * identity across that — see `ListRefetchIdentity` for the mechanism and `RMD051` for the
     * diagnostic. What is asserted here is the stake: the text a person was in the middle of typing.
     */
    const app = await getDOM<Board>(<Board />);
    await app.settle();
    const input = await userIsTypingInB(app);

    app.instance.tasks = JSON.parse(JSON.stringify(app.instance.tasks));
    await app.settle();

    expect(app.container.querySelector("#in-b")).toBe(input);
    expect(input.value).toBe("half typed");
    expect(app.container.querySelector("#bump-b")!.textContent).toBe("1");
  });
});

describe("what a moved row loses, and what an unkeyed refetch loses", () => {
  test("moving the row itself blurs it — everything else survives", async () => {
    /**
     * The limitation, measured rather than assumed. A row that is physically moved is removed and
     * reinserted, and an element removed from the document loses focus — the platform, not this
     * framework. Its node, its typed text, its caret and its `@state` all come through; only the
     * focus does not.
     *
     * Restoring it is possible — record the active element and its selection before the reorder, put
     * them back after — and is a decision rather than a fix, so it is not made here. This test is
     * what makes that decision visible: it will start failing the day someone takes it.
     */
    const app = await getDOM<Board>(<Board />);
    await app.settle();
    const input = await userIsTypingInB(app);

    // `b` moves to the front, so `b` is the node that is picked up.
    app.instance.tasks = [app.instance.tasks[1]!, app.instance.tasks[0]!, app.instance.tasks[2]!];
    await app.settle();

    expect(rowOrder(app)).toBe("row-b,row-a,row-c");
    expect(app.container.querySelector("#in-b")).toBe(input);
    expect(input.value).toBe("half typed");
    expect(input.selectionStart).toBe(4);
    expect(app.container.querySelector("#bump-b")!.textContent).toBe("1");
    // The one thing that does not come back.
    expect(document.activeElement).not.toBe(input);
  });

  test("an UNKEYED row survives a refetch too, because list() infers identity", async () => {
    /**
     * Measured, and the opposite of what I assumed when I wrote this file: an unkeyed row keeps its
     * node, its typed text and its `@state` through a refetch that replaces every object, reorders
     * them, drops one, and changes a label. `list()` identifies a row by what sets it apart from its
     * siblings — here the `id` — so new objects carrying the same ids are the same rows.
     *
     * A `key` is still the stronger statement, and the one to write when the data has no such field:
     * see `ListRefetchIdentity` for a row whose only distinguishing field restates its position, and
     * `RMD051` for the diagnostic that names a row carrying nothing to tell it apart.
     */
    const app = await getDOM<Unkeyed>(<Unkeyed />);
    await app.settle();
    const input = await userIsTypingInB(app as unknown as Awaited<ReturnType<typeof getDOM<Board>>>);

    app.instance.tasks = JSON.parse(
      JSON.stringify([app.instance.tasks[1], app.instance.tasks[0], app.instance.tasks[2]]),
    );
    await app.settle();

    expect(rowOrder(app)).toBe("row-b,row-a,row-c");
    expect(app.container.querySelector("#in-b")).toBe(input);
    expect(input.value).toBe("half typed");
    expect(app.container.querySelector("#bump-b")!.textContent).toBe("1");
  });
});
