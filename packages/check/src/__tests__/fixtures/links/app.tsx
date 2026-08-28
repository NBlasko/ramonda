import { Component, bootstrap } from "@ramonda/core";

const HASH = "#";
const EMPTY = "";

class Links extends Component {
  render() {
    return (
      <div>
        {/* ✗ The four spellings that go nowhere. */}
        <a>no href</a>
        <a href="">empty</a>
        <a href="#">bare fragment</a>
        <a href="javascript:void 0">script</a>

        {/* ✗ The same, one name away. */}
        <a href={HASH}>named hash</a>
        <a href={EMPTY}>named empty</a>

        {/* ✗ Upper case, and whitespace, are the same claim. */}
        <a href="JAVASCRIPT:void 0">shouting</a>
        <a href="   ">spaces</a>

        {/* ✗ A button wearing a link's clothes — the advice says so, which is what `handled` is for.
            The attribute is `onclick`, which is what core renamed it to; `has` is case-insensitive
            and matched the old spelling, so this proves the rename did not silence it. */}
        <a onclick={() => {}}>a handler instead</a>

        {/* ✓ A fragment that names something is a real destination. */}
        <a href="#pricing">to pricing</a>
        {/* ✓ The legacy anchor TARGET — written to be jumped to. */}
        <a id="pricing">a target</a>
        {/* ✓ A real destination. */}
        <a href="/guide">the guide</a>
      </div>
    );
  }
}

bootstrap(<Links />, null);
