import { Component } from "@ramonda/core";
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

/** A form under a type with a `reset` of its own, given back. */
function asResettable(): Resettable {
  return forma;
}

export class Follows extends Component {
  form = this.use(Form, {});

  clear() {
    a.reset(); // ✗ browser-reset — through a type alias
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
