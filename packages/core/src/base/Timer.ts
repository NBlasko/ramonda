import { ownerRuntime } from "../core/renderEnv";
import { delayFault } from "../debug/validateDecorator";
import { destroyed } from "./decorators";
import { Hook } from "./Hook";

/**
 * A timer the app starts, and the framework still owns.
 *
 * `@interval` and `@timeout` answer one question — "run this on a clock for as long as I am on the
 * page" — and they answer it in one line, with nothing to hold and nothing to clear. This answers a
 * different one: **"start now, and stop when I say."** A delay that begins on a click, a deadline
 * armed inside a promise, a retry scheduled after a failure. None of those can be written as a
 * decorator, because a decorator fires relative to MOUNT.
 *
 * ```tsx
 * class ExitCard extends Component<{ id: number }> {
 *   private removal = this.use(Timer);
 *
 *   leave() {
 *     this.leaving = true;
 *     this.removal.after(3000, () => this.props.onRemove(this.props.id));
 *   }
 *
 *   cancel() {
 *     this.removal.stop();
 *   }
 * }
 * ```
 *
 * ## What it is for, which is the leak
 *
 * A raw `setTimeout` outlives the component. Three seconds later it writes state on something that is
 * gone — Ramonda drops the write (`RMD008`), so the symptom is not a crash but a handler that quietly
 * does nothing on a page that has moved on. The documented fallback was to keep the id on a class
 * property and clear it from `@destroyed`, and that is exactly the boilerplate this deletes: **one
 * hook instance is one timer, and teardown clears it.**
 *
 * ## One timer per instance, and re-arming RESTARTS
 *
 * `stop()` then has no question of "which", and no handle has to travel back to the caller — the
 * shape that killed the alternative. A decorator cannot add a member TypeScript can see (measured:
 * `this.deadline.stop()` is `TS2339`, because a decorator may replace what runs and never the
 * declared type), so the stop has to belong to an object, and this is that object.
 *
 * Two timers means two hooks:
 *
 * ```tsx
 * private removal = this.use(Timer);
 * private deadline = this.use(Timer);
 * ```
 *
 * Arming an armed timer clears the first one. For `repeat` that is the only correct answer — two
 * intervals on one name would both keep firing, and nothing could name either — and `after` follows
 * it rather than having a second rule of its own.
 *
 * ## Nothing is armed during a server render
 *
 * A timer has no meaning while a page is being turned into a string: it could not fire before the
 * response is sent, and the request would be held open by a handle nobody can reach. So `after` and
 * `repeat` DO NOTHING on the server.
 *
 * They return quietly rather than throwing, and that is the whole reason it is safe to call them from
 * shared code. The same method runs on both sides — a `@created` is `shared` by default — so a throw
 * would force every call site to branch on which side it is, which is the one thing the hydration
 * rules tell an author not to do.
 *
 * The side comes from `ownerRenderEnv`, which holds the reason a hook reads it off its OWNER rather
 * than off the module flag — `Portal` asks the same question through the same function.
 */
export class Timer extends Hook {
  /**
   * How to clear whatever is currently armed — a closure rather than the id, because `after` and
   * `repeat` need `clearTimeout` and `clearInterval` respectively, and one field that already knows
   * which cannot be asked the wrong question.
   */
  private disarm: (() => void) | undefined;

  /**
   * Whether arming can be made safe right now — one question, because all three answers to it mean
   * the same thing: do not start a timer nothing will clear.
   *
   * - **A server render.** It could not fire before the response is sent, and the request would be
   *   held open by a handle nobody can reach.
   * - **The owner is gone.** `@destroyed` has already run, so nothing would ever clear it. A late
   *   `await` landing in a handler is how that happens — `RMD008` reports the write it would have
   *   made, and the timer itself would hold the component alive until it fired.
   * There is no third case. A hook always has an owner — `Runtime.owner` is required, and the note
   * there says what it cost to find that out — so "we do not know which side we are on" is not a state
   * this can be in.
   *
   * `ownerRuntime` holds the reason the side is read off the OWNER rather than off a module flag.
   */
  private get armable(): boolean {
    const owner = ownerRuntime(this);
    return owner.env !== "server" && !owner.isDestroyed;
  }

  /**
   * OUTSIDE `__DEV__`, unlike the decorators' copy of the same check, and the difference is the delay
   * itself: `@timeout(3000)` is a literal an author reads, while `after(this.props.backoffMs, run)`
   * arrives at runtime and may be `undefined`, `NaN` or negative because an API said so.
   *
   * Guarded, the two builds would disagree about that value: development throws, and production hands
   * `NaN` to `setTimeout`, which coerces it to `0` — so a retry fires on the next tick and storms,
   * silently, in the only build where it matters. That is the shape `useCommon`'s `RMD055` throw is
   * unguarded for, and the shape `@compute`'s `assertNoParameters` is unguarded for.
   *
   * The judgement is `delayFault`'s, so the decorators and this cannot disagree about what a delay is.
   */
  private checkDelay(method: string, ms: number): void {
    const fault = delayFault(ms);
    if (fault !== undefined) throw new RangeError(`[Timer.${method}] ${fault}`);
  }

  /**
   * Runs `run` once, `ms` from now. Clears anything this timer already had armed.
   *
   * **Returns whether it armed**, which is `false` on the server and `false` once the owner is gone.
   * A caller that only wants the timer can ignore it; a caller that has promised somebody an answer
   * cannot, because a refusal means the answer will never arrive by this route:
   *
   * ```ts
   * if (!this.net.after(ms, () => this.resolve())) this.resolve();
   * ```
   *
   * Without that, a refusal is indistinguishable from a timer that has not fired yet — measured on the
   * first caller, where it left a view transition holding a snapshot over the page for ever.
   */
  after(ms: number, run: () => void): boolean {
    this.checkDelay("after", ms);
    this.stop();
    if (!this.armable) return false;

    const id = setTimeout(() => {
      // Cleared BEFORE the body, so a `stop()` from inside `run` is not undone by this line, and so
      // `disarm` never points at a timeout that has already fired.
      this.disarm = undefined;
      run();
    }, ms);
    this.disarm = () => clearTimeout(id);
    return true;
  }

  /**
   * Runs `run` every `ms` until `stop()`, or until the owner is gone. Clears anything this timer
   * already had armed.
   *
   * Returns whether it armed, for the reason `after` gives.
   */
  repeat(ms: number, run: () => void): boolean {
    this.checkDelay("repeat", ms);
    this.stop();
    if (!this.armable) return false;

    const id = setInterval(run, ms);
    this.disarm = () => clearInterval(id);
    return true;
  }

  /**
   * Clears whatever is armed. Safe to call when nothing is.
   *
   * `@destroyed` as well as public, deliberately: teardown and "stop it now" are the same act, and
   * two members would let them drift apart. The decorator does not change what the method is — it
   * registers it — so `this.removal.stop()` reads exactly as it looks.
   */
  @destroyed
  stop(): void {
    this.disarm?.();
    this.disarm = undefined;
  }
}
