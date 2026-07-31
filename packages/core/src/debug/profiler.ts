/**
 * What one commit cost, and which components it rebuilt.
 *
 * ## Why this exists at all
 *
 * The framework's central claim is about the cost of a commit — that a render is a few percent of it,
 * that access tracking turned nine renders into three, that structural sharing turned 272 ms into
 * 1.3 ms. Every one of those numbers was measured in a test and none of them was ever visible in the
 * panel. An app author cannot check the claim against their own app, which is the only place it
 * matters.
 *
 * ## Why it records only when asked
 *
 * A commit is the hottest path there is, and a profiler that samples it always is a tax on every
 * development build whether or not anybody looks. So it is off, and the whole cost while off is one
 * boolean test per drain and one per build — the same shape React's profiler has, for the same
 * reason.
 *
 * Measured, and measured properly — the first attempt ran "off" then "on" once each and reported
 * recording as FASTER, because a warm-up drift of that size swamps the effect. Alternating the two and
 * taking medians (7 rounds of 200 commits over a 51-component tree, jsdom):
 *
 * ```
 *   off        253.9 ms   (runs: 268 248 260 244 264 254 251)
 *   recording  263.0 ms   (runs: 272 262 263 252 264 257 263)
 *              → 3.6%
 * ```
 *
 * Two timestamps per build and one map write, for 3.6% while you are watching and nothing when you are
 * not. That is the trade the design wants, and the reason the flag exists rather than a sampling rate.
 *
 * ## What a commit means here
 *
 * One DRAIN, not one build. A single state write can rebuild a parent and twelve children, run their
 * effects, and let an `@updated` write schedule more work — and all of it lands in one synchronous
 * drain, which is what the user waits for. Timing individual builds and summing them would hide
 * exactly the part that hurts: the diff, the DOM, and the post-commit flush.
 */

/** One component's share of a commit. */
export interface ComponentCost {
  name: string;
  builds: number;
  /** Milliseconds inside `updateBuild` — render, diff and DOM for this component. */
  ms: number;
}

/** One drain: what the app waited for. */
export interface CommitRecord {
  /** 1-based, in the order they happened, so the panel can say "commit 12" and mean it. */
  index: number;
  /** `performance.now()` when the drain started. */
  at: number;
  /** The whole drain: builds, effects, mounts, `@updated`, and everything they scheduled. */
  duration: number;
  builds: number;
  /** Per component, heaviest first. */
  components: ComponentCost[];
}

/**
 * How many commits are kept. A hundred covers an interaction and its cascade; keeping every commit of
 * a long session would be a memory leak with a nice name.
 */
const MAX_COMMITS = 100;

let recording = false;
let commits: CommitRecord[] = [];
let sequence = 0;

/** The commit being built up, or `undefined` between drains. */
let current: { at: number; started: number; builds: number; costs: Map<string, ComponentCost> } | undefined;

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function startRecording(): void {
  recording = true;
  commits = [];
  sequence = 0;
}

export function stopRecording(): void {
  recording = false;
  current = undefined;
}

export function isRecording(): boolean {
  return recording;
}

/** What the panel reads. A copy, so the panel cannot hold or mutate the buffer. */
export function takeCommits(): CommitRecord[] {
  return commits.map((commit) => ({ ...commit, components: commit.components.map((cost) => ({ ...cost })) }));
}

export function beginCommit(): void {
  if (!recording) return;
  current = { at: now(), started: now(), builds: 0, costs: new Map() };
}

/**
 * Records one component's build.
 *
 * Called with the elapsed time rather than measuring here, because the caller already has to bracket
 * the build to catch what it throws — asking it for the two numbers it already holds beats taking two
 * more timestamps.
 */
export function recordBuild(name: string, ms: number): void {
  if (!recording || !current) return;

  current.builds++;
  const existing = current.costs.get(name);
  if (existing) {
    existing.builds++;
    existing.ms += ms;
    return;
  }
  current.costs.set(name, { name, builds: 1, ms });
}

export function endCommit(): void {
  if (!recording || !current) return;

  const { at, started, builds, costs } = current;
  current = undefined;

  // A drain that built nothing is not a commit anybody waited for — it is the queue being emptied of
  // components that were already up to date, and listing it would bury the ones that matter.
  if (builds === 0) return;

  commits.push({
    index: ++sequence,
    at,
    duration: now() - started,
    builds,
    components: [...costs.values()].sort((a, b) => b.ms - a.ms),
  });

  if (commits.length > MAX_COMMITS) commits.shift();
}
