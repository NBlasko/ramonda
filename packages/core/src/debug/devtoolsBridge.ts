import { scanComponentTree, writeInspectedState, type InspectedNode } from "./inspector";
import { isRecording, startRecording, stopRecording, takeCommits } from "./profiler";

// Whether the devtools panel is currently open + watching components. While
// false, the core does NO inspector work — the whole cost is opt-in.
let devtoolsWatching = false;
let inspectRoot: Node | null = null;
let tickScheduled = false;

// `registerStore` used to live here: it let a module-level singleton (invisible
// to the component-tree walk) publish itself to a devtools STORES section. The
// router was its only user, and it now keeps its route state in a plain @state
// field, which the walk finds like any other component state. Nothing needs the
// escape hatch, and keeping it would advertise the module-global pattern we are
// deliberately steering away from.

/** Bootstrap tells us which element the app mounted into (scan root). */
export function setInspectRoot(root: Node): void {
  inspectRoot = root;
}

/** Pulled by the devtools (same window) to read the live component/hook tree. */
export function inspectTree(): InspectedNode[] {
  return scanComponentTree(inspectRoot ?? document.body);
}

/**
 * Installs the DEV bridge: exposes the live-inspect pull function on `window`
 * and listens for the devtools telling us when it starts/stops watching.
 * Idempotent.
 */
export function initDevtoolsBridge(): void {
  if (typeof window === "undefined") return;
  // Note: if two copies of the core are ever loaded, the second returns here and
  // never registers its listeners, so its `devtoolsWatching` stays false and its
  // updates never tick. Duplicate bundles are the real bug in that case.
  const w = window as unknown as {
    __RAMONDA_INSPECT__?: typeof inspectTree;
    __RAMONDA_WRITE__?: typeof writeInspectedState;
    __RAMONDA_PROFILE__?: {
      start(): void;
      stop(): void;
      isRecording(): boolean;
      commits(): ReturnType<typeof takeCommits>;
    };
  };
  if (w.__RAMONDA_INSPECT__) return;
  w.__RAMONDA_INSPECT__ = inspectTree;
  /**
   * The write side of the same bridge, and it is deliberately narrow: one field, by a handle THIS
   * process handed out, and only when that field is `@state` or `@persist`. The panel cannot reach
   * an instance, call a method, or touch props through it.
   */
  w.__RAMONDA_WRITE__ = writeInspectedState;

  /**
   * The profiler's controls. Off until the panel presses record, because a commit is the hottest path
   * in the framework and a profiler that samples it always is a tax on every development build.
   */
  w.__RAMONDA_PROFILE__ = {
    start: startRecording,
    stop: stopRecording,
    isRecording,
    commits: takeCommits,
  };

  window.addEventListener("ramonda:devtools-watch", () => {
    devtoolsWatching = true;
  });
  window.addEventListener("ramonda:devtools-unwatch", () => {
    devtoolsWatching = false;
  });
}

/**
 * Cheap, gated, frame-coalesced "something updated" ping. Does nothing unless
 * the devtools is actively watching, so a closed/minimized panel costs nothing.
 * Carries no payload — the devtools pulls the tree itself.
 */
export function notifyComponentUpdate(): void {
  if (!devtoolsWatching || typeof window === "undefined") return;
  if (tickScheduled) return;
  tickScheduled = true;

  const fire = () => {
    tickScheduled = false;
    // Re-checked: the panel can close between scheduling and the frame, and a
    // stray tick makes the devtools scan a tree nobody is looking at — which is
    // exactly the cost this gate exists to avoid.
    if (!devtoolsWatching) return;
    window.dispatchEvent(new CustomEvent("ramonda:tick"));
  };

  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fire);
  else setTimeout(fire, 16);
}
