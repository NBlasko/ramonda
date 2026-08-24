import { Component, bootstrap } from "@ramonda/core";

declare const tracks: unknown[];

/** `accessKey` and media without a track, each beside the shapes that are correct. */
class Player extends Component {
  render() {
    return (
    <div>{(
      <div>
        {/* REPORTED — a shortcut the reader's own software may already be using. */}
        <button accessKey="s">Save</button>
        {/* REPORTED — the same, on a plain element and with no readable character. */}
        <div accessKey={"x"}>Menu</div>

        {/* REPORTED — nothing to read instead of listening. */}
        <video src="/talk.mp4" controls />
        {/* REPORTED — audio has the same problem and a different fix. */}
        <audio src="/episode.mp3" controls />
        {/* REPORTED — `chapters` is navigation rather than the words. */}
        <video src="/talk.mp4">
          <track kind="chapters" src="/c.vtt" />
        </video>

        {/* Not reported: captions are there. */}
        <video src="/talk.mp4">
          <track kind="captions" src="/en.vtt" srcLang="en" label="English" />
        </video>
        {/* Not reported: `subtitles` is the same file under the name most people know. */}
        <video src="/talk.mp4">
          <track kind="subtitles" src="/en.vtt" />
        </video>
        {/* Not reported: no `kind` at all defaults to `subtitles`. */}
        <video src="/talk.mp4">
          <track src="/en.vtt" />
        </video>
        {/* Not reported: no sound to caption — the decorative background loop. */}
        <video src="/loop.mp4" muted autoplay />
        {/* Not reported: children this cannot read may well be the track. */}
        <video src="/talk.mp4">{tracks}</video>
        {/* Not reported: nothing claims a shortcut. */}
        <button>Cancel</button>
      </div>
    );}</div>
  )}
}

bootstrap(<Player />, null);