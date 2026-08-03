import { afterEach, describe, expect, test } from "vitest";
import { Component } from "../base/Component";
import { state } from "../base/decorators";
import { beginCommit, endCommit, isRecording, startRecording, stopRecording, takeCommits } from "../debug/profiler";
import { flushSync } from "../testing";
import { getDOM } from "../test/setup";

/**
 * The profiler: what one commit cost and which components it rebuilt.
 *
 * These cover behaviour only. The number the opt-in design rests on — a profiler that samples the
 * hottest path unconditionally is a tax on every development build whether or not anybody looks —
 * is measured and recorded in `debug/profiler.ts`, not here. A wall-clock comparison inside a test
 * that shares a machine with the rest of the suite cannot produce it; see "stopping really stops".
 */

class Row extends Component<{ label: string }> {
  render() {
    return <li>{this.props.label}</li>;
  }
}

class Board extends Component {
  @state title = "a";
  @state rows = 3;

  render() {
    return (
      <div>
        <h1>{this.title}</h1>
        <ul>
          {Array.from({ length: this.rows }, (_, i) => (
            <Row key={String(i)} label={`${this.title}-${i}`} />
          ))}
        </ul>
      </div>
    );
  }
}

afterEach(() => {
  stopRecording();
});

describe("recording a commit", () => {
  test("is off until asked, and records nothing while off", async () => {
    using app = await getDOM<Board>(<Board />);
    const { instance } = app;

    expect(isRecording()).toBe(false);
    instance.title = "b";
    flushSync();

    expect(takeCommits()).toEqual([]);
  });

  test("records the whole drain, and every component that built in it", async () => {
    using app = await getDOM<Board>(<Board />);
    const { instance } = app;

    startRecording();
    instance.title = "b";
    flushSync();

    const [commit] = takeCommits();
    expect(commit).toBeDefined();
    expect(commit.index).toBe(1);
    // The board plus its three rows: one write, four builds, one commit — which is the point of
    // recording a DRAIN rather than a build.
    expect(commit.builds).toBe(4);
    expect(commit.components.map((c) => c.name).sort()).toEqual(["Board", "Row"]);

    const rows = commit.components.find((c) => c.name === "Row")!;
    expect(rows.builds).toBe(3);
    expect(rows.ms).toBeGreaterThanOrEqual(0);
    expect(commit.duration).toBeGreaterThanOrEqual(0);
  });

  test("orders components by what they cost, heaviest first", async () => {
    using app = await getDOM<Board>(<Board />);
    const { instance } = app;

    startRecording();
    instance.rows = 50;
    flushSync();

    const [commit] = takeCommits();
    const times = commit.components.map((c) => c.ms);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  test("numbers commits in the order they happened", async () => {
    using app = await getDOM<Board>(<Board />);
    const { instance } = app;

    startRecording();
    for (const title of ["b", "c", "d"]) {
      instance.title = title;
      flushSync();
    }

    expect(takeCommits().map((c) => c.index)).toEqual([1, 2, 3]);
  });

  /**
   * A drain that built nothing is the queue being emptied, not a commit anybody waited for.
   *
   * Driven through `beginCommit`/`endCommit` rather than through the app, because an app cannot
   * reliably produce one: `flushSync` with empty queues never enters the drain at all, so the version
   * of this test that just called it passed with the guard deleted. It proved nothing, which a
   * mutation run is how you find out.
   */
  test("skips a drain in which nothing built", async () => {
    using app = await getDOM<Board>(<Board />);
    void app;

    startRecording();
    beginCommit();
    endCommit();

    expect(takeCommits()).toEqual([]);
  });

  test("a flush with nothing pending is not a commit either", async () => {
    using app = await getDOM<Board>(<Board />);
    void app;

    startRecording();
    flushSync();

    expect(takeCommits()).toEqual([]);
  });

  test("keeps the last hundred commits and no more", async () => {
    using app = await getDOM<Board>(<Board />);
    const { instance } = app;

    startRecording();
    for (let i = 0; i < 120; i++) {
      instance.title = `t${i}`;
      flushSync();
    }

    const commits = takeCommits();
    expect(commits.length).toBe(100);
    // The OLDEST went, so what is left ends at the newest — a profiler that dropped the newest would
    // be useless for the interaction you just made.
    expect(commits.at(-1)!.index).toBe(120);
    expect(commits[0]!.index).toBe(21);
  });

  test("hands the panel a copy it cannot corrupt", async () => {
    using app = await getDOM<Board>(<Board />);
    const { instance } = app;

    startRecording();
    instance.title = "b";
    flushSync();

    const first = takeCommits();
    first[0]!.components[0]!.ms = -1;
    expect(takeCommits()[0]!.components[0]!.ms).toBeGreaterThanOrEqual(0);
  });

  test("starting again throws away what was recorded before", async () => {
    using app = await getDOM<Board>(<Board />);
    const { instance } = app;

    startRecording();
    instance.title = "b";
    flushSync();
    expect(takeCommits().length).toBe(1);

    startRecording();
    expect(takeCommits()).toEqual([]);
  });
});

describe("turning recording off", () => {
  /**
   * **Asserted, never timed** — and this test took three tries to get there.
   *
   * 1. It first compared two timed runs and required the recorded one to be within a factor of the
   *    other. Under a full parallel `turbo run test` recording measured 33% FASTER than not
   *    recording (off 1424 ms, on 953 ms). A test that can fail — or pass — for reasons that have
   *    nothing to do with the code is not a gate, it is a coin toss with a stack trace.
   * 2. The comparison went, but the timed loops stayed, printing an off-vs-recording ratio nobody
   *    could trust: a single unalternated pair is exactly the shape that produced the 33% above.
   *    The phase count was cut from 200 to 60 to stay clear of vitest's 5s default — except there
   *    were FOUR phases (warm-up 20, off 60, recording 60, off again 60), so the total was still
   *    200 and the timeout was still one busy machine away. It duly fired: **6734 ms** under a
   *    parallel `turbo run check`, failing a test that asserts nothing about time.
   * 3. Now the two loops that existed only to feed that log are gone, which is 40% of the work, and
   *    the tree is 21 components rather than 51 — it was only ever that wide to make the timing
   *    meaningful. Measured: 307 ms → 126 ms idle.
   *
   * The real overhead number is in `profiler.ts`, taken the way it has to be: alternating, medians
   * of seven rounds, 3.6%.
   *
   * The explicit timeout is the belt to that braces. Nothing here asserts duration, so duration must
   * never be what decides the verdict — and a CI machine can always be slower than the one this was
   * measured on.
   */
  test("stopping really stops", async () => {
    using app = await getDOM<Board>(<Board />);
    const { instance } = app;
    // Wide enough that the per-component recording is genuinely exercised, not so wide that the
    // test's runtime becomes a factor. See the note above for why it used to be 50.
    instance.rows = 20;
    flushSync();

    const run = (times: number) => {
      for (let i = 0; i < times; i++) {
        instance.title = `t${i}`;
        flushSync();
      }
    };

    startRecording();
    run(60);
    expect(takeCommits().length).toBe(60);
    expect(takeCommits().at(-1)!.index).toBe(60);

    stopRecording();
    run(60);
    // Sixty more commits over a 21-component tree and the buffer did not move: the flag is really
    // off, not merely reported off.
    expect(takeCommits().length).toBe(60);
    expect(takeCommits().at(-1)!.index).toBe(60);
  }, 30_000);
});
