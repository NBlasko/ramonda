import { Component, bootstrap } from "@ramonda/core";

declare const tracks: unknown[];
declare const rest: Record<string, unknown>;

const CHAPTERS = "chapters";
const CAPTIONS = "captions";

/** `accessKey` and media without a track, each beside the shapes that are correct. */
class Player extends Component {
  render() {
    return (
      <div>
        {/* REPORTED — a shortcut the reader's own software may already be using. */}
        <button accessKey="s">Save</button>
        {/* REPORTED — the same, on a plain element and with no readable character. */}
        <div accessKey={"x"}>Menu</div>

        {/* REPORTED — nothing to read instead of listening. */}
        <video src="/talk.mp4" controls />
        {/* REPORTED — audio has the same problem and a different fix. */}
        <audio src="/episode.mp3" controls />
        {/* Not reported: a LABEL is the answer for music, which is what the advice asks for. */}
        <audio src="/song.mp3" controls aria-label="Chopin, Nocturne op. 9 no. 2, 4:33" />
        {/* Not reported: the same, said by reference. */}
        <audio src="/other.mp3" controls aria-labelledby="now-playing" />
        {/* Not reported: a name computed at runtime is a name. */}
        <audio src="/live.mp3" controls aria-label={rest.title as string} />
        {/* REPORTED — a label written and nothing said. */}
        <audio src="/quiet.mp3" controls aria-label="" />
        {/* Not reported: a labelled VIDEO is the same argument. */}
        <video src="/loop.mp4" controls aria-label="Rotating logo, 6s" />
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

        {/* REPORTED — the same claim as `kind="chapters"`, one NAME away. */}
        <video src="/talk.mp4">
          <track kind={CHAPTERS} src="/c.vtt" />
        </video>
        {/* Not reported: the usable kind, also one name away. */}
        <video src="/talk.mp4">
          <track kind={CAPTIONS} src="/en.vtt" />
        </video>
        {/* Not reported: a spread may carry or replace the `kind`, so this one cannot be judged. */}
        <video src="/talk.mp4">
          <track kind="chapters" {...rest} />
        </video>
        {/* Not reported: nothing claims a shortcut. */}
        <button>Cancel</button>
      </div>
    );
  }
}

bootstrap(<Player />, null);
