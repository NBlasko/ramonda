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
  /*
   * ## The `as const` this needs, and two ways round it that were MEASURED and do not ship
   *
   * `this.use(Listener, () => ({ on: "document", … }))` does not compile: an object literal widens
   * `"document"` to `string`, and `Q` takes a candidate from the factory's return as well as from
   * the hook. So the call site writes `on: "document" as const`. Both ways out were tried on
   * TypeScript 5.9.3, and neither is a matter of taste:
   *
   * - **`PropsFactory<NoInfer<Q>, S>`**, which is the textbook fix for a type parameter inferred
   *   from two places. It CRASHES the compiler — `Debug Failure. No error for 3 or fewer overload
   *   signatures`, thrown from `resolveCall`. Not "does not help": tsc does not finish.
   * - **A `const` type parameter** (`use<T, const Q, S>`). This works, and the example compiles
   *   with no `as const` — but a `const` parameter keeps every inferred array as a READONLY tuple,
   *   and hook props take arrays. Measured on the whole repo: six call sites in core's own tests
   *   stop compiling, `children: [<Wrap />, <u />]` among them, because a readonly tuple is not a
   *   `RamondaNode[]`. Buying one keyword back costs the array shape of every hook.
   *
   * And it is ONE prop, not a pattern: `on` is the only hook prop in the framework typed as a
   * string-literal union, so the `as const` is a single line in a single API rather than a wart the
   * reader meets repeatedly. That is why it stands.
   */

  /** The event name, as the DOM spells it — `keydown`, not `onKeyDown`. */
  type: string;

  /**
   * What runs. Read when the event FIRES, not when the listener was armed, so a `run` chosen by a
   * signal takes effect without re-arming — the same contract `Timeout` and `Interval` keep.
   *
   * ## `Event`, and three ways of narrowing it that were tried and rejected
   *
   * The decorators type this from the NAME — `@onDocument("keydown") onKey(e: KeyboardEvent)` needs
   * no cast — because the name is a literal in their signature. Here it is a PROP, and that is the
   * whole difference. Measured, all three:
   *
   * - **A generic `Listener<K>`** with `type: K` and `run: (e: EventFor<K>) => void` compiles, and
   *   inference does not reach it: `this.use(Listener, () => ({ type: "keydown", run: (e) => … }))`
   *   gives `e` an implicit `any`, because `K` would have to be inferred from `use`'s SECOND
   *   argument back into a class generic its FIRST already fixed.
   * - **An annotation at the call site** — `run: (e: KeyboardEvent) => …` — is refused, because a
   *   function-typed property is contravariant in its parameter.
   * - **Method syntax** (`run(event: Event): void`) makes that annotation compile, by making the
   *   parameter bivariant. It also makes `type: "keydown"` with `run: (e: MouseEvent) => …` compile,
   *   which is the same lie as the cast while LOOKING like a check. A cast at least announces
   *   itself, so this is the one that was rejected on purpose rather than for want of a way.
   *
   * So it is `Event`, and the narrowing is the author's and visible:
   * `run: (e) => this.onKey(e as KeyboardEvent)`. When the listener lives for the owner's whole
   * life, `@onDocument` is the better tool and is genuinely checked.
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
 * The globals are returned without asking whether they exist. This is reached only past `listen`'s
 * `armable` check, and `armable` is false when `owner.env === "server"` — so by here there is a
 * document. A `typeof` guard would be a branch nothing can enter.
 *
 * A FUNCTION target may still answer `null`, and that is a state rather than a fault: an element
 * behind a branch that has not rendered, a ref before its node exists. `listen` returns `false` for
 * it, which is the one thing a caller can act on.
 */
function targetOf(on: ListenerProps["on"]): EventTarget | null {
  if (on === "window") return window;
  if (on === "document") return document;
  return on();
}
