import { Component } from "@ramonda/core";
import { type Value } from "../../css-system";

/**
 * **One block, written to react to every constraint in `ramonda.css.ts`.**
 *
 * This is the file to keep open while editing that config. Each declaration below is labelled with
 * the setting it answers to, so a change in the config shows up here immediately — in the editor as
 * a squiggle, and from `pnpm --filter @ramonda/playground-core check-types` as a report.
 *
 * `WALKTHROUGH.md` at the root of this app is the list of edits to make. It compiles as it stands,
 * which is the starting point: every line here is legal under the config as committed.
 *
 * It is not a demo of anything and is not routed. It exists to be broken on purpose.
 */
export default class ConfigPlayground extends Component {
  /**
   * A value made OUTSIDE the block, which is what `Value<…>` is for.
   *
   * `padding-left` says it takes a length, and a bare template literal is a `string` — which could
   * be anything at run time. Delete the annotation and this stops compiling; that is the cost of a
   * property saying what it takes, and the annotation is the whole of the answer.
   */
  private readonly inset: Value<"padding-left"> = "12px";

  render() {
    return (
      <div
        css={@@(
          /* ── variables: `$` reaches what the config declares ───────────────────────
             Try `$.color.accent.` and watch the group complete one level at a time.
             Try `$.color.accent.nope` — reported twice, by the type and by the rule.
             Try `padding-left: $.color.accent.main` — a colour is not a length.        */
          color: $.color.text.primary;
          background: $.color.surface.base;
          border-left: 4px solid $.color.accent.main;

          /* ── `values`: z-index is [0, 1, 10, 100, 1000] in this project ────────────
             Change this to 5 and it is reported. In the editor, type `z-index: 1` and
             look at the list: only the permitted values, no `auto` and no `calc()`.    */
          z-index: 10;

          /* ── `arity`: uncomment `"*": { arity: 1 }` and this line is reported ──────
             `padding` takes one value in this project, and this is 2.
             The two below it stay silent: a call is one value, and `border-left`'s
             parts are a width, a style and a colour rather than three values.          */
          padding: 8px 12px;
          margin: calc(1rem + 2px);

          /* ── `units`: uncomment `"*": { units: ["px", "rem", "%"] }` ───────────────
             `em` is refused then, and the `px` line beside it is not.                  */
          letter-spacing: 0.05em;
          gap: 4px $.space.gutter.tight;

          /* ── `shorthand`: uncomment `"*": { shorthand: false }` ────────────────────
             `padding` and `background` above stop existing — and are gone from the
             completion list too, because the names come from the block's own type.
             `padding-left` and `background-color` are untouched, which is the point.   */
          padding-left: {this.inset};

          &:hover {
            border-left-color: $.color.accent.quiet;

            & .label {
              text-decoration: underline;
            }
          }
        )}
      >
        <span class="label">Edit ramonda.css.ts and watch this file</span>
      </div>
    );
  }
}
