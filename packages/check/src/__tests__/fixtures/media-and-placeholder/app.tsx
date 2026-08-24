import { Component, Host, bootstrap } from "@ramonda/core";

@Host("div")
class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ The plain case, as the control. */}
        <video src="/a.mp4" />

        {/* ✓ Muted has no sound to caption. */}
        <video src="/b.mp4" muted />

        {/* ✗ Written `muted={false}`, which SAYS it has sound. */}
        <video src="/c.mp4" muted={false} />

        {/* ✓ A track inside a fragment is still a track. */}
        <video src="/d.mp4">
          <>
            <track kind="captions" src="/d.vtt" />
          </>
        </video>

        {/* ✗ A control named only by its placeholder. */}
        <input type="text" placeholder="Email" />

        {/* ✗ An EMPTY placeholder names nothing at all. */}
        <input type="text" placeholder="" />

        {/* ✓ Named properly, so the placeholder is a hint and not the name. */}
        <label htmlFor="phone">Phone</label>
        <input id="phone" type="text" placeholder="+381…" />
      </div>
    );
  }
}

bootstrap(<App />, null);
