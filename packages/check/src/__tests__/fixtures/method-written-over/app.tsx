import { Component, Hook, bootstrap, state } from "@ramonda/core";

declare function debounce<T>(fn: T, ms: number): T;

class Takes extends Hook<{ run: () => void }> {}

class Base extends Component {
  save(): void {}
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

  swap(): void {
    /* REPORTED — a handler writing a method of its own. */
    this.submit = this.send;
    /* REPORTED — a method inherited from the base. */
    this.save = this.send;
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
  }

  render() {
    return <p>{this.mode}</p>;
  }
}

bootstrap(<Editor />, null);
