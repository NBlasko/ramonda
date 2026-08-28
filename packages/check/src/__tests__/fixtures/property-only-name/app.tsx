import { Component, bootstrap } from "@ramonda/core";

class App extends Component {
  render() {
    return (
      <div>
        {/* ✗ Lowercased, which is what the types encourage — and it writes nothing. */}
        <video muted src="/a.mp4" playbackrate={2} />
        {/* ✗ The same for the other two on a media element. */}
        <video muted src="/b.mp4" currenttime={30} />
        <audio muted src="/c.mp3" playbackrate={1.5}>
          <track kind="descriptions" src="/c.vtt" />
        </audio>

        {/* ✓ Spelled as the property, which is the only spelling these have. */}
        <video muted src="/d.mp4" playbackRate={2} />
        <video muted src="/e.mp4" currentTime={30} />
        <video muted src="/f.mp4" volume={0.5} />
        {/* ✓ A checkbox's third state, which core sets as a property now. */}
        <input type="checkbox" aria-label="Some" indeterminate={true} />

        {/* ✓ `volume` is already lower case, so there is no wrong spelling of it. */}
        <audio muted src="/g.mp3" volume={0.5}>
          <track kind="descriptions" src="/g.vtt" />
        </audio>
        {/* ✓ A real attribute that only LOOKS like these. */}
        <video muted src="/h.mp4" width={640} />
      </div>
    );
  }
}

bootstrap(<App />, null);
