import { escapeHtml } from "./format";

interface ComponentCost {
  name: string;
  builds: number;
  ms: number;
}

/** One drain — what the app waited for. See core's `profiler.ts`. */
interface CommitRecord {
  index: number;
  at: number;
  duration: number;
  builds: number;
  components: ComponentCost[];
}

interface ProfileBridge {
  start(): void;
  stop(): void;
  isRecording(): boolean;
  commits(): CommitRecord[];
}

/**
 * The profiler tab: one row per commit, with the components that made it up.
 *
 * A list with numbers rather than a flamegraph, and that is a decision rather than a stopgap — what a
 * Ramonda commit is made of is WHICH components rebuilt and how many times, and a flame chart of a
 * flat drain is a picture of one bar. The bar per component here is its share of that commit, which
 * is the question worth asking: not "is this slow" but "why did forty rows rebuild when one changed".
 *
 * ## Self-contained, and that is the point
 *
 * The panel hands it a shadow root and tells it when to watch. Everything else — the poll timer, the
 * bridge, what was last drawn — is its own, so nothing here is reachable from another tab and
 * nothing here reaches into one. It is the smallest tab, which is why it goes first: it says what
 * shape the others should end up in.
 */
export class ProfileTab {
  private timer: ReturnType<typeof setInterval> | undefined;
  /** What was last drawn, so a poll that finds nothing new writes no DOM. */
  private shape = "";

  constructor(private readonly root: ShadowRoot) {}

  /**
   * The profiler's controls, off until this panel presses record — a commit is the hottest path in the
   * framework, and an always-on recorder would be a tax on every app that ever opens devtools.
   */
  private get bridge(): ProfileBridge | undefined {
    return (window as unknown as { __RAMONDA_PROFILE__?: ProfileBridge }).__RAMONDA_PROFILE__;
  }

  bind(): void {
    this.root.querySelector("#profile-record")?.addEventListener("click", () => {
      const bridge = this.bridge;
      if (!bridge) return;
      // Recording starts from empty, which is what a profiler is for: you press it because you are
      // about to do the thing you want to measure.
      if (bridge.isRecording()) bridge.stop();
      else bridge.start();
      this.shape = "";
      this.render();
    });
  }

  /**
   * Polls while the tab is being looked at, for the same reason the query tab does: the panel PULLS.
   * A commit does not notify anybody, and pushing would mean the profiler telling a panel nobody is
   * looking at.
   */
  watch(shouldWatch: boolean): void {
    if (!shouldWatch) {
      this.stop();
      return;
    }

    if (this.timer !== undefined) return;
    this.shape = "";
    this.render();
    this.timer = setInterval(() => this.render(), 400);
  }

  /** Also the teardown path: the panel calls it when it leaves the page. */
  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private render(): void {
    const container = this.root.querySelector("#profile-container");
    const button = this.root.querySelector("#profile-record") as HTMLElement | null;
    const hint = this.root.querySelector("#profile-hint");
    const bridge = this.bridge;
    if (!container || !button || !hint) return;

    if (!bridge) {
      container.innerHTML =
        '<p class="p-empty">This build has no profiler. It arrives with a development build of @ramonda/core.</p>';
      return;
    }

    const recording = bridge.isRecording();
    button.classList.toggle("on", recording);
    button.textContent = recording ? "■ stop" : "● record";

    const commits = bridge.commits();
    hint.textContent = recording
      ? `recording · ${commits.length} commit${commits.length === 1 ? "" : "s"}`
      : commits.length > 0
        ? `${commits.length} commit${commits.length === 1 ? "" : "s"} · stopped`
        : "";

    if (commits.length === 0) {
      container.innerHTML = recording
        ? '<p class="p-empty">Recording. Interact with the app — every commit lands here.</p>'
        : '<p class="p-empty">Press record, then use the app. A commit is one drain: everything a single state change rebuilt, including the effects and <code>@updated</code> bodies it scheduled — which is what the app actually waited for.</p>';
      this.shape = "";
      return;
    }

    // The list is keyed on the commits themselves, so a poll that finds nothing new writes no DOM.
    const shape = commits.map((commit) => `${commit.index}:${commit.duration}`).join("|");
    if (shape === this.shape) return;
    this.shape = shape;

    // Newest first: the commit you just caused is the one you are looking for.
    container.innerHTML = [...commits]
      .reverse()
      .map((commit) => renderCommit(commit))
      .join("");
  }
}

function renderCommit(commit: CommitRecord): string {
  const heaviest = commit.components[0]?.ms ?? 0;
  const costs = commit.components
    .map((cost) => {
      const share = heaviest > 0 ? Math.max(2, Math.round((cost.ms / heaviest) * 100)) : 2;
      const times = cost.builds > 1 ? ` ×${cost.builds}` : "";
      return `<span class="p-name">${escapeHtml(cost.name)}${times}</span><span class="p-bar"><span style="width:${share}%"></span></span><span class="p-cost">${cost.ms.toFixed(
        2,
      )} ms</span>`;
    })
    .join("");

  return `<div class="p-row" data-p-commit="${commit.index}">
      <div class="p-head">
        <span class="p-index">#${commit.index}</span>
        <span class="p-ms">${commit.duration.toFixed(2)} ms</span>
        <span class="p-builds">${commit.builds} build${commit.builds === 1 ? "" : "s"} · ${
          commit.components.length
        } component${commit.components.length === 1 ? "" : "s"}</span>
      </div>
      <div class="p-costs">${costs}</div>
    </div>`;
}
