import { Component, Hook, bootstrap, state } from "@ramonda/core";

declare function debounce<T>(fn: T, ms: number): T;

class Takes extends Hook<{ run: () => void }> {}

class Base extends Component {
  save(): void {}
  cancel(): void {}
}

/** Every write to a method this class has, and the writes beside them that are not one. */
class Editor extends Base {
  @state mode = "draft";
  /* A field holding a function made by a call: a field, not a method — `cached-read-of-a-plain-field`'s. */
  later = debounce(this.send, 200);

  form = this.use(Takes, () => ({ run: this.submit }));

  constructor() {
    super();
    /* REPORTED — in the constructor, after the field initializer already handed `submit` over. */
    this.submit = this.send;
  }

  submit(): void {}
  send(): void {}
  /* A field on this class, though the base has a method of the name: writing it writes a field. */
  cancel = () => {};

  swap(): void {
    /* REPORTED — a handler writing a method of its own. */
    this.submit = this.send;
    /* REPORTED — a method inherited from the base. */
    this.save = this.send;
    /* REPORTED — through a pattern, both shapes, and through Object.assign. */
    [this.submit] = [this.send];
    ({ submit: this.submit } = { submit: this.send });
    Object.assign(this, { submit: this.send });
    /* Not reported: the nearest `cancel` is a field. */
    this.cancel = () => {};
    /* Not reported: a field. */
    this.later = this.send;
    /* Not reported: a nested class's own `this`. */
    class Inner {
      submit(): void {}
      reset(): void {
        this.submit = () => {};
      }
    }
    void Inner;
    /* Not reported: a `function`'s own `this`, and an object literal's. */
    const el = {
      addEventListener(_t: string, f: () => void) {
        void f;
      },
    };
    el.addEventListener("x", function (this: { submit: boolean }) {
      this.submit = true;
    });
    const o = {
      submit() {},
      reset() {
        this.submit = () => {};
      },
    };
    void o;
  }

  /* Not reported: a static member's `this` is the class, whatever it names. */
  static configure(this: { submit: unknown }): void {
    this.submit = 1;
  }

  render() {
    return <p>{this.mode}</p>;
  }
}

bootstrap(<Editor />, null);
