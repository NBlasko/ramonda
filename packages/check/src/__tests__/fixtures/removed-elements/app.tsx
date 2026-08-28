import { Component, bootstrap } from "@ramonda/core";

declare const rest: Record<string, unknown>;

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ The two that MOVE, which is a WCAG 2.2.2 failure on its own. */}
        <marquee>latest news</marquee>
        <blink>look here</blink>

        {/* ✗ The presentational ones HTML dropped. */}
        <center>centred</center>
        <font size="3">styled</font>
        <big>large</big>
        <strike>gone</strike>
        <tt>code-ish</tt>

        {/* ✗ And the rest a person might still type. */}
        <acronym title="HyperText Markup Language">HTML</acronym>
        <nobr>unbroken</nobr>

        {/* ✗ No spread makes a removed tag into a current one. */}
        <marquee {...rest}>news</marquee>

        {/* ✓ The replacements, which are all still real elements. */}
        <s>no longer accurate</s>
        <del>removed</del>
        <abbr title="HyperText Markup Language">HTML</abbr>
        <code>const x = 1;</code>
        <kbd>Esc</kbd>
        <ul>
          <li>a list of names</li>
        </ul>
        <audio muted src="/a.mp3">
          <track kind="descriptions" src="/a.vtt" />
        </audio>
      </div>
    );
  }
}

bootstrap(<App />, null);
