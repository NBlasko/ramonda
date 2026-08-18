import { bootstrap, Component, Field, Form } from "../framework";

declare const schema: unknown;
declare const defaultValues: unknown;

/** THE FAULT: reads a field it was handed, and watches nothing. It will never re-render. */
class Broken extends Component<{ of: any }> {
  render() {
    return <input {...this.props.of.$.bind} />;
  }
}

/** The same fault written through a local, which is how most people write it. */
class BrokenViaLocal extends Component<{ of: any }> {
  render() {
    const f = this.props.of.$;
    return (
      <label>
        <input value={f.value} />
        <span>{f.error}</span>
      </label>
    );
  }
}

/** Fixed: the hook is what subscribes this component to that one path. */
class Watched extends Component<{ of: any }> {
  f = this.use(Field<string>, () => ({ of: this.props.of }));
  render() {
    return <input {...this.f.bind} />;
  }
}

/**
 * Silent, and this is the one that would be a false positive: it only WRITES through the field. A
 * write needs no subscription, and whoever shows the value is somebody else.
 */
class WriteOnly extends Component<{ of: any }> {
  clear() {
    this.props.of.$.set("");
  }
  render() {
    return <button onClick={this.clear}>clear</button>;
  }
}

/** Silent: it passes the field down without reading it, which is what a layout does. */
class Layout extends Component<{ of: any }> {
  render() {
    return <Watched of={this.props.of} />;
  }
}

/** Silent: the OWNER reads its own fields, and reading `form.fields` is asking about the form. */
class Page extends Component {
  form = this.use(Form, () => ({ schema, defaultValues, onSubmit: () => {} }));
  render() {
    return (
      <form>
        <span>{this.form.fields.email.$.error}</span>
        <Broken of={this.form.fields.email} />
        <BrokenViaLocal of={this.form.fields.name} />
        <Watched of={this.form.fields.nick} />
        <WriteOnly of={this.form.fields.nick} />
        <Layout of={this.form.fields.city} />
      </form>
    );
  }
}

bootstrap(<Page />, null);
