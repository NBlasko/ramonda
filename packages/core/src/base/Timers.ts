import { delayFault } from "../debug/validateDecorator";
import { Armed } from "./Armed";
import { state } from "./decorators";

/** What a scheduled call runs. Declared once, with the hook, and read again every time it fires. */
export interface ScheduledProps {
  /**
   * The method to call. A METHOD, not a function written at the call site — that is the whole point of
   * it living here.
   *
   * It is read **when the timer fires**, not when it was started, so a `run` chosen by a signal takes
   * effect on a call that is already waiting:
   *
   * ```tsx
   * private beat = this.use(Interval, () => ({ run: this.paused ? this.hold : this.tick }));
   * ```
   *
   * Nothing is cancelled by that change. The deadline belongs to `start`, and what happens at the
   * deadline belongs here — two questions, answered in two places. Cancelling stays explicit: `stop()`.
   */
  run: () => void;
}

/**
 * One scheduled call, started by the app and owned by the framework.
 *
 * `@interval` and `@timeout` answer "run this on a clock for as long as I am on the page", in one line
 * and with nothing to hold. `Timeout` and `Interval` answer a different question — **"start now, stop
 * when I say"** — which no decorator can express, because a decorator fires relative to MOUNT. A delay
 * that begins on a click, a deadline armed inside a promise, a retry after a failure.
 *
 * ```tsx
 * class ExitCard extends Component<{ id: number; onRemove: (id: number) => void }> {
 *   @state leaving = false;
 *   private removal = this.use(Timeout, () => ({ run: this.remove }));
 *
 *   leave() {
 *     this.leaving = true;
 *     this.removal.start(3000);
 *   }
 *
 *   stay() {
 *     this.removal.stop();
 *     this.leaving = false;
 *   }
 *
 *   private remove() {
 *     this.props.onRemove(this.props.id);
 *   }
 * }
 * ```
 *
 * ## What it is for, which is the leak
 *
 * A raw `setTimeout` outlives the component. Three seconds later it writes state on something that is
 * gone — Ramonda drops the write (`RMD008`), so the symptom is not a crash but a handler that quietly
 * does nothing on a page that has moved on. The documented fallback was to keep the id on a class
 * property and clear it from `@destroyed`, and that is exactly the boilerplate this deletes: **one hook
 * instance is one timer, and teardown clears it.**
 *
 * ## One instance is one timer, and the shape says so
 *
 * `run` is declared WITH the hook rather than passed to `start`, and that is not a preference. An API
 * that takes the body per call reads as "order as many as you like" while behaving as "only the last
 * one survives" — it invites a fresh function at every call site, and then nothing at that site says
 * whether the function captured a local or reads `this.props`. Declared once, there is nothing to
 * capture.
 *
 * Two timers means two hooks:
 *
 * ```tsx
 * private removal = this.use(Timeout, () => ({ run: this.dropRow }));
 * private deadline = this.use(Timeout, () => ({ run: this.giveUp }));
 * ```
 *
 * Starting a running one restarts it: `start` clears whatever this instance had before. So `stop()`
 * never asks which, and no handle travels back to the caller — the shape that killed the alternative.
 * A decorator cannot add a member TypeScript can see (measured: `this.deadline.stop()` is `TS2339`,
 * because a decorator may replace what runs and never the declared type), so the stop has to belong to
 * an object, and this is that object.
 *
 * ## `ms` belongs to `start`, and `run` to the hook
 *
 * Split by how long each one lives. The delay is a property of THIS start — a retry's backoff differs
 * every time — so it is an argument, and no signal has to be watched for it to change. What to run is a
 * property of the timer, so it sits with the declaration.
 *
 * ## Nothing is started during a server render, or before the component is built
 *
 * A timer has no meaning while a page is being turned into a string: it could not fire before the
 * response is sent, and the request would be held open by a handle nobody can reach. So `start` does
 * nothing there, and **returns `false`** rather than throwing.
 *
 * It returns `false` from a field initializer too, on either side — see `armable`. A component that is
 * not built yet has no teardown to clear anything, so a timer started there is one nothing owns. Start
 * from `@created` or later.
 *
 * Quietly, because that is what makes it safe to call from shared code. The same method runs on both
 * sides — a `@created` is `shared` by default — so a throw would force every call site to branch on
 * which side it is, which is the one thing the hydration rules tell an author not to do.
 */
/**
 * A scheduled call the app starts and stops. `Armed` carries when it may arm and that it is undone
 * once; this adds the only thing a timer has that a listener does not — a DELAY, and the argument
 * that its value has to be checked at runtime rather than only in development.
 */
abstract class Scheduled extends Armed<ScheduledProps> {
  /**
   * Starts it, `ms` from now, clearing anything this instance was already running.
   *
   * **Returns whether it started**, which is `false` on the server and `false` once the owner is gone.
   * A caller that only wants the timer can ignore it; a caller that has promised somebody an answer
   * cannot, because `false` means the callback will never run:
   *
   * ```ts
   * if (!this.deadline.start(1000)) this.settle();
   * ```
   *
   * Without that, a refusal is indistinguishable from a timer that has not fired yet — measured on the
   * first caller, where it left a view transition holding a snapshot over the page for ever.
   */
  /**
   * Whether a run is scheduled and has not happened yet.
   *
   * `@state`, so a render that reads it is re-rendered when it flips — which is the whole point: a
   * button that says "Cancel" while a deadline is running, a row that shows a spinner until the
   * retry fires. Before this the only way to know was to keep a second field beside the timer and
   * remember to write it in three places.
   *
   * **It costs no hydration bytes.** A hook's `@state` travels in the blob, but the serializer
   * writes only what MOVED off its initializer — and nothing arms on the server, because `armable`
   * is false there. So this is `false` on both sides and is never written. Asserted in
   * `Timers.test.tsx`.
   *
   * **The devtools panel shows it under THIS name, not `pending`.** `readState` lists every
   * `@state` key with no privacy filter, so a `Timeout` in the panel reads `scheduled: true` while
   * the API a caller writes is `pending`. The two cannot share a name — a public field would let
   * anybody assign it — and a rename facility for the panel is machinery this does not earn. Named
   * here so the next reader knows it is the design and not a leak.
   */
  @state private scheduled = false;

  /** Whether a run is scheduled and has not happened yet. See {@link scheduled}. */
  get pending(): boolean {
    return this.scheduled;
  }

  start(ms: number): boolean {
    this.checkDelay(ms);
    this.stop();
    if (!this.armable) return false;

    this.disarm = this.schedule(ms);
    this.scheduled = true;
    return true;
  }

  /**
   * Clears the timer AND the state, which is why this is overridden rather than inherited.
   *
   * `Armed.stop()` knows about `disarm` and nothing else. Teardown goes through it as well, so an
   * unmounted timer reads `pending === false` — a hook whose state said otherwise after its owner
   * was gone would be a claim about a callback that can never run.
   */
  override stop(): void {
    super.stop();
    this.scheduled = false;
  }

  /** Arms the platform timer and hands back how to clear it. */
  protected abstract schedule(ms: number): () => void;

  /**
   * For a one-shot: the handle is dead the moment it fires, and this is called BEFORE the body runs.
   *
   * The ordering is load-bearing. Clearing it after the body wipes the handle a body that starts the
   * timer again has just installed — the timer keeps running, teardown finds nothing to clear, and the
   * component is held alive by a callback nobody can name. Every other test passes under both orders.
   */
  protected spent(): void {
    this.disarm = undefined;
    this.scheduled = false;
  }

  /**
   * OUTSIDE `__DEV__`, unlike the decorators' copy of the same check, and the difference is where the
   * number comes from: `@timeout(3000)` is a literal an author reads, while `start(this.props.backoffMs)`
   * arrives at runtime and may be `undefined` or `NaN` because an API said so.
   *
   * Guarded, the two builds would disagree about that value: development throws, and production hands
   * `NaN` to `setTimeout`, which coerces it to `0` — so a retry fires on the next tick and storms,
   * silently, in the only build where it matters. That is the shape `useCommon`'s `RMD055` throw is
   * unguarded for, and the shape `@compute`'s `assertNoParameters` is unguarded for.
   *
   * The judgement is `delayFault`'s, so the decorators and this cannot disagree about what a delay is.
   */
  private checkDelay(ms: number): void {
    const fault = delayFault(ms);
    if (fault !== undefined) throw new RangeError(`[${this.label}.start] ${fault}`);
  }

  /**
   * The name this hook goes by in the message above, as a LITERAL rather than `this.constructor.name`.
   *
   * The production bundle is minified without `keepNames`, so the classes emit as anonymous class
   * expressions and `constructor.name` came out as `it` — in the one message deliberately kept in
   * production, which is the whole argument for the check being unguarded. `TimerDelay.prod.test.tsx`
   * cannot catch that: vitest compiles from source, where the names survive.
   */
  protected abstract readonly label: string;
}

/** Runs `run` once, `ms` after `start`. See `Scheduled`. */
export class Timeout extends Scheduled {
  protected readonly label = "Timeout";

  /**
   * Whether the run has HAPPENED — a one-shot's other half, and only a one-shot's.
   *
   * `Interval` deliberately has no `done`: it does not finish, so a field for it would be a
   * question with no answer, and one more thing on every instance. That asymmetry is the reason
   * this lives here rather than on `Scheduled`.
   *
   * Reset by `start`, so a timer started again is pending and not done — the two are never both
   * true, and after a `stop()` before it fired both are false, which is the third state a caller
   * needs (`cancelled`, in their own words) without a third field.
   */
  @state private fired = false;

  /** Whether the run has happened. See {@link fired}. */
  get done(): boolean {
    return this.fired;
  }

  override start(ms: number): boolean {
    this.fired = false;
    return super.start(ms);
  }

  protected override spent(): void {
    super.spent();
    this.fired = true;
  }

  protected schedule(ms: number): () => void {
    const id = setTimeout(() => {
      this.spent();
      // Read, then call. `this.props.run()` would invoke it as a METHOD of the props proxy, so any
      // function that is not auto-bound gets the read-only bag as `this` and throws RMD015 from inside
      // a timer callback, naming nothing the author wrote.
      const run = this.props.run;
      run();
    }, ms);
    return () => clearTimeout(id);
  }
}

/** Runs `run` every `ms` from `start` until `stop`, or until the owner is gone. See `Scheduled`. */
export class Interval extends Scheduled {
  protected readonly label = "Interval";

  protected schedule(ms: number): () => void {
    const id = setInterval(() => {
      // Read, then call — see `Timeout.schedule`.
      const run = this.props.run;
      run();
    }, ms);
    return () => clearInterval(id);
  }
}
