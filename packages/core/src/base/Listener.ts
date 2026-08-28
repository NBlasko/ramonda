import { Armed } from "./Armed";

/** Where a listener goes, and what it does there. Declared once, with the hook. */
export interface ListenerProps {
  /**
   * The target, named rather than handed over — and that is not a style choice.
   *
   * `window` does not exist on the server, so a prop holding the value would be evaluated where
   * there is nothing to evaluate. The two common targets are therefore words, resolved when the
   * listener is actually armed, which is only ever on the client. `@onWindow` resolves its target
   * exactly this way and for exactly this reason.
   *
   * A function is the third form, for a target the app owns: `() => this.box.current`. It is called
   * at ARM time, so a ref that is not attached yet answers `null` and the listener refuses rather
   * than attaching to nothing.
   */
  on: "window" | "document" | (() => EventTarget | null);

  /** The event name, as the DOM spells it — `keydown`, not `onKeyDown`. */
  type: string;

  /**
   * What runs. Read when the event FIRES, not when the listener was armed, so a `run` chosen by a
   * signal takes effect without re-arming — the same contract `Timeout` and `Interval` keep.
   *
   * `Event` rather than a type derived from `type`, which the decorators can do because the name is
   * a literal in their signature and this cannot because it is a prop. Narrow it where you write it:
   * `run: (e) => this.onKey(e as KeyboardEvent)`.
   */
  run: (event: Event) => void;

  /** Passed through to `addEventListener`, and to the matching `removeEventListener`. */
  options?: boolean | AddEventListenerOptions;
}

/**
 * A listener the app turns ON at some moment and OFF at another, which the framework still removes.
 *
 * `@onWindow` and `@onDocument` attach for the owner's whole life, which is right for most listeners
 * and wrong for the ones that are the point of this: a `keydown` armed while a dialog is open, a
 * `pointermove` armed while a drag is happening, a `scroll` armed after something loads. Written by
 * hand, each of those is an `addEventListener` and a `removeEventListener` that have to agree with
 * each other and with teardown — three places for one fact, and `listener-added-by-hand` reports it
 * precisely because that is where the leak lives.
 *
 * `Timeout` and `Interval` are the same problem already solved for timers, and this is deliberately
 * their shape: the app calls `listen()` and `stop()`, and {@link Armed} owns the rest.
 *
 * ```tsx
 * class Dialog extends Component {
 *   private escape = this.use(Listener, {
 *     on: "document",
 *     type: "keydown",
 *     run: (e) => {
 *       if ((e as KeyboardEvent).key === "Escape") this.close();
 *     },
 *   });
 *
 *   @mounted open() {
 *     this.escape.listen();
 *   }
 *
 *   close() {
 *     this.escape.stop();
 *   }
 * }
 * ```
 *
 * One hook instance is one listener, and teardown removes it. Nothing has to be remembered.
 */
export class Listener extends Armed<ListenerProps> {
  /**
   * Arms it, removing anything this instance already had.
   *
   * **Returns whether it attached**, which is `false` on the server, `false` once the owner is gone,
   * and `false` when the target resolves to nothing. A caller that only wants the listener can
   * ignore it; one that has told somebody the key is live cannot, because `false` means it is not.
   */
  listen(): boolean {
    this.stop();
    if (!this.armable) return false;

    const target = targetOf(this.props.on);
    if (target === null) return false;

    /**
     * Every one of these is read ONCE and captured, and that is what makes removal correct.
     *
     * `removeEventListener` matches on the triple of type, function identity and capture — so a
     * `type` re-read at teardown, after a signal changed it, would ask the DOM to remove a listener
     * that was never added and silently leave the real one attached. The same is true of the target
     * and of `options`. What may change between arming and firing is `run`, which is read inside the
     * handler on purpose: that is the contract `Timeout` and `Interval` keep, and it changes nothing
     * about which listener is registered.
     */
    const { type, options } = this.props;
    const handler = (event: Event): void => {
      // Read, then call. `this.props.run(event)` would invoke it as a METHOD of the props proxy, so
      // a function that is not auto-bound gets the read-only bag as `this` and throws from inside a
      // DOM callback, naming nothing the author wrote.
      const run = this.props.run;
      run(event);
    };

    target.addEventListener(type, handler, options);
    this.disarm = () => target.removeEventListener(type, handler, options);
    return true;
  }
}

/**
 * The target, resolved at ARM time rather than when the hook was declared.
 *
 * The words are checked against `typeof` rather than assumed, exactly as `@onWindow` does: this
 * runs only on the client, and a `null` here is a refusal rather than a throw for the same reason
 * the decorator's is — a component that renders on both sides must not have to branch on which.
 */
function targetOf(on: ListenerProps["on"]): EventTarget | null {
  if (on === "window") return typeof window === "undefined" ? null : window;
  if (on === "document") return typeof document === "undefined" ? null : document;
  return on();
}
