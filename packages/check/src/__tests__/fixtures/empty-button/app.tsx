import { Component, Host, bootstrap } from "@ramonda/core";

declare function close(): void;
declare const label: string;

@Host("span")
class Icon extends Component {
  render() {
    return null;
  }
}

@Host("div")
class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ Nothing inside at all. */}
        <button type="button" onclick={close} />

        {/* ✗ The icon button: content in the DOM, none in the accessibility tree. */}
        <button type="button" onclick={close}>
          <span aria-hidden="true">×</span>
        </button>

        {/* ✓ `aria-label` is what it is for. */}
        <button type="button" aria-label="Close" onclick={close}>
          <span aria-hidden="true">×</span>
        </button>

        {/* ✓ Text inside is the name. */}
        <button type="button" onclick={close}>
          Close
        </button>

        {/* ✓ One readable word beside the icon is enough. */}
        <button type="button" onclick={close}>
          <span aria-hidden="true">×</span> Close
        </button>

        {/* ✓ Content this cannot read may well be text. */}
        <button type="button" onclick={close}>
          {label}
        </button>

        {/* ✓ A COMPONENT child renders what it renders. */}
        <button type="button" onclick={close}>
          <Icon />
        </button>

        {/* ✓ `aria-labelledby` names it too. */}
        <button type="button" aria-labelledby="heading" onclick={close} />

        {/* ✓ An `<input type="submit">` is named by its value and a browser default — that is
            `control-with-no-label`'s territory and its documented boundary. */}
        <input type="submit" />
        <input type="button" />
      </div>
    );
  }
}

bootstrap(<App />, null);
