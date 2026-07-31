import { afterEach, describe, expect, test } from "vitest";
import { Component } from "../base/Component";
import { state } from "../base/decorators";
import { beginCommit, endCommit, isRecording, startRecording, stopRecording, takeCommits } from "../debug/profiler";
import { flushSync } from "../testing";
import { getDOM } from "../test/setup";

/**
 * The profiler: what one commit cost and which components it rebuilt.
 *
 * The measurement at the bottom is the reason the whole thing is opt-in, and it is the number the
 * design rests on — a profiler that samples the hottest path in the framework unconditionally is a tax
 * on every development build whether or not anybody looks.
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
    instance.rows = 40;
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

describe("what recording costs", () => {
  /**
   * Reported, NOT asserted — and that distinction is the point.
   *
   * The first version of this test compared two timed runs and required the recorded one to be within
   * a factor of the other. On an idle machine that held; under a full parallel `turbo run test` the
   * numbers swung far enough that recording measured 33% FASTER than not recording (off 1424 ms, on
   * 953 ms). A test that can fail — or pass — for reasons that have nothing to do with the code is not
   * a gate, it is a coin toss with a stack trace.
   *
   * So the number is printed for whoever runs this file, the real measurement lives in `profiler.ts`
   * (taken deliberately, alternating runs, medians of seven rounds: 3.6%), and what is ASSERTED here
   * is the thing that cannot flake: recording produces commits, stopping produces none, and the same
   * loop runs either way.
   *
   * The loop is also deliberately SHORT. At 200 commits per phase it took 3.6 seconds under a full
   * parallel `turbo run test` — against vitest's 5-second default, which is a timeout waiting to
   * happen and the most likely cause of a failure I saw once and could not reproduce. Sixty is enough
   * to make the point and fast enough to never be the reason a run goes red.
   */
  test("is reported, and stopping really stops", async () => {
    using app = await getDOM<Board>(<Board />);
    const { instance } = app;
    instance.rows = 50;
    flushSync();

    const run = (times: number) => {
      const started = performance.now();
      for (let i = 0; i < times; i++) {
        instance.title = `t${i}`;
        flushSync();
      }
      return performance.now() - started;
    };

    run(20); // warm up, so neither number pays for the first JIT pass

    const off = run(60);
    startRecording();
    const on = run(60);
    expect(takeCommits().length).toBe(60);
    expect(takeCommits().at(-1)!.index).toBe(60);

    stopRecording();
    const offAgain = run(60);
    /**
     * The loop ran 200 more times and the buffer did not move: the flag is really off, not merely
     * reported off. This is what replaced a comparison of two timings, which under a loaded machine
     * measured recording as FASTER than not recording.
     */
    expect(takeCommits().length).toBe(60);
    expect(takeCommits().at(-1)!.index).toBe(60);

    console.log(
      `[profiler] 60 commits × 51 components — off: ${off.toFixed(0)}ms · recording: ${on.toFixed(0)}ms · ` +
        `off again: ${offAgain.toFixed(0)}ms (a loaded machine makes this ratio meaningless; see profiler.ts)`,
    );
  });
});
