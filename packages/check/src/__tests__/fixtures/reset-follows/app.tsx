import { Component, Hook } from "@ramonda/core";
import { Form } from "@ramonda/form";

type Formica = HTMLFormElement;
interface Moja extends Formica {}
interface Resettable {
  reset(): void;
}
declare const a: Formica;
declare const b: Moja;
declare const forma: HTMLFormElement;
declare const platno: CanvasRenderingContext2D;
declare const loose: any;
declare const key: string;
declare const index: number;
declare function clearLater(target: Resettable): void;
const RESET = "reset";
const ACTION = "action";

interface TypedForm<T> extends HTMLFormElement {
  values: T;
}
declare const typed: TypedForm<string>;
declare const callable: { (): void; reset(): void };
/** A class of the project's own with a reset and nothing else a form lacks: its instance is the class. */
class Stopwatch {
  reset() {}
}
declare const watch: Stopwatch;
declare const options: { reset: boolean };
declare const counted: { reset(): void; length: () => number };
declare const mixed: { reset(): void; count: number } | Resettable;
// `void` rather than `undefined`, which the fixtures' non-strict base drops from a union.
declare const actions: Record<string, () => void>;
declare const counterOrNothing: { reset(): void; count: number } | void;
declare const node: HTMLElement;

/** A hook that holds an element, as a ref does. */
class Holder extends Hook {
  current: HTMLElement | null = null;
}

/** A type naming more of a form than its reset — the form fits it all the same. */
function clearBoth(target: { reset(): void; submit(): void }) {
  target.reset(); // ✗ form-retyped
}

/** A name that happens to be `reset`, holding another member's name: `action` is what is taken. */
function byAName() {
  const reset = "action";
  const { [reset]: taken } = forma; // ✓ takes `action`
  return taken;
}

/** A form under a type with a `reset` of its own, given back. */
function asResettable(): Resettable {
  return forma;
}

export { byAName, clearBoth };

export class Follows extends Component {
  form = this.use(Form, {});
  holder = this.use(Holder) as Holder;

  clear() {
    a.reset(); // ✗ browser-reset — through a type alias
    typed.reset(); // ✗ browser-reset — through a generic interface extending the form
    if (node instanceof HTMLFormElement) node.reset(); // ✗ browser-reset — narrowed by instanceof
    this.holder.current?.reset(); // ✗ form-retyped — an element a hook holds
    const both: { reset(): void; elements: unknown } = forma;
    both.reset(); // ✗ form-retyped
    const loosely: { reset(): void; extra?: number } = forma;
    loosely.reset(); // ✗ form-retyped — a member a form lacks, but optional
    mixed.reset(); // ✗ form-retyped — one member of the union a form fits
    callable.reset(); // ✓ a function with a reset of its own is no form
    watch.reset(); // ✓ a class's instance is that class, as its author wrote it
    options.reset; // ✓ a flag named reset, which no form's method fits
    counted.reset(); // ✓ a form's length is a number, not a function
    // @ts-expect-error — `void` has no `reset`; the union is what is asked about, not the call
    counterOrNothing.reset(); // ✓ no form, or nothing at all
    const helpers: Record<string, unknown> = {};
    helpers[RESET] = clearBoth; // ✓ a member written, not taken
    (helpers as { reset?: unknown }).reset = clearBoth; // ✓ the same, by its name
    helpers[RESET]; // ✗ form-retyped — taken from a type a form fits
    b.reset(); // ✗ browser-reset — through an interface extending the alias
    const nesto = forma;
    nesto.reset(); // ✗ browser-reset — under another name
    const clearIt = forma.reset; // ✗ browser-reset — the method taken out
    clearIt.call(forma);
    forma.reset.bind(forma); // ✗ browser-reset — bound
    forma["reset"](); // ✗ browser-reset — by a string
    forma[RESET](); // ✗ browser-reset — by a const
    forma[key]; // ✗ browser-reset — by a key that cannot be read
    const { reset: r } = forma; // ✗ browser-reset — destructured under another name
    r();
    const { reset } = forma; // ✗ browser-reset — destructured
    reset();
    loose["reset"](); // ✗ browser-reset — on a value whose type cannot be read
    const { reset: maybe } = loose; // ✗ browser-reset — destructured from one
    maybe();
    const kontekst = forma as unknown as CanvasRenderingContext2D; // ✗ form-cast
    kontekst.reset();
    (forma as unknown as CanvasRenderingContext2D).reset(); // ✗ form-cast
    ((forma as unknown)! as CanvasRenderingContext2D).reset(); // ✗ form-cast
    forma as unknown as CanvasRenderingContext2D as unknown as Path2D; // ✗ form-cast — once for the chain
    (forma as unknown as CanvasRenderingContext2D)! as unknown as Path2D; // ✗ form-cast — once, through `!`
    const c: Resettable = forma;
    c.reset(); // ✗ form-retyped
    const holder: { target: Resettable } = { target: forma };
    holder.target.reset(); // ✗ form-retyped
    const box: { forma: Resettable } = { forma };
    box.forma.reset(); // ✗ form-retyped
    asResettable().reset(); // ✗ form-retyped
    clearLater(forma);

    platno.reset(); // ✓ a canvas, named by its type
    forma[index]; // ✓ a control, by index
    forma[0]; // ✓ the first control
    forma["action"]; // ✓ another member, by a string
    forma[ACTION]; // ✓ another member, by a const
    forma as HTMLElement; // ✓ a form cast to the element it is
    forma as Resettable; // ✓ a form cast to a type it fits — its reset is followed there
    forma as TypedForm<string>; // ✓ a form cast to a form
    forma as { id: string }; // ✓ a form cast to a type naming one of its members
    actions.reset(); // ✓ a map of functions, which a form's members are not
    const { [RESET]: clearByAConst } = forma; // ✗ browser-reset — destructured by a const
    clearByAConst();
    loose[key]; // ✓ an unread value by an unread key: anything at all, asked about nothing
    const element: HTMLElement = forma; // ✓ a form as the element it is
    forma as unknown; // ✓ a form as nothing in particular
    this.form.reset(); // ✓ the model's own
    const { reset: ownReset } = this.form; // ✓ destructured from the model
    ownReset();
    element.focus();
  }

  render() {
    return <div>x</div>;
  }
}
