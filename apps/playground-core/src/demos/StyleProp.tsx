import { Component, state } from "@ramonda/core";
import type { CssBlock, Var } from "../../css-system";

/**
 * **`$` is not imported, and that is not an omission.** A variable written in a block is resolved
 * by the compiler and becomes a `var()` in the stylesheet, so nothing reads `$` at run time — the
 * virtual file the checker builds puts it in scope on its own. Importing it anyway is an unused
 * import, which `ramonda-css lint` says so about.
 */

/**
 * What a component lets a caller restyle, and what it does not.
 *
 * A `css` prop typed as a plain `CssBlock` takes every block there is, which is the same as having
 * no answer to *what may a caller change*. Giving it an allow-list is the answer: the properties
 * are the keys, and each key's TYPE is what that property may be set to.
 *
 * Everything below is live. Break one of the commented lines back open and the editor refuses it on
 * the spot — on the value, on the property name, or inside the state — and so does
 * `pnpm --filter @ramonda/playground-core check-types`.
 */

/**
 * The root's allow-list: two colours from the theme, one of two radii, and a hover colour.
 *
 * `Var<"color">` is every variable this project declares of that kind, so a caller may recolour a
 * chip and may NOT write `#ff0055` — the palette stays the one place colours are decided. `Var` and
 * `$` are both written by codegen from `ramonda.css.ts`, so editing that file moves this.
 */
type ChipStyle = {
  color?: Var<"color">;
  "background-color"?: Var<"color">;
  "border-radius"?: Var<"length">;
  "&:hover"?: { "background-color"?: Var<"color"> }[];
};

/**
 * The label is a SECOND slot, because one slot is one element.
 *
 * A caller reaching the label through a combinator — `& > span` — would be reaching into a
 * structure this component is free to change. A named part is the opposite: it is promised, and
 * this component has to keep it working.
 *
 * There used to be a second type here — `StaticCssBlock` — refusing a runtime value, because a chip
 * may be rendered a hundred times in a list and a hole was a custom property set on every one of
 * them. A runtime value in a declaration is refused everywhere now, so there is nothing left for a
 * prop to refuse and `CssBlock` is the only type. A caller still varies what they send with
 * `when $(…) { … }` and `match`, both of which pick between whole rules.
 */
type ChipLabelStyle = {
  "font-weight"?: 400 | 600;
  "letter-spacing"?: Var<"length">;
};

export class Chip extends Component<{
  label: string;
  css?: CssBlock<ChipStyle>;
  labelCss?: CssBlock<ChipLabelStyle>;
}> {
  render() {
    return (
      <span
        className={@@(
          display: inline-flex;
          align-items: center;
          gap: $space.gutter.tight;
          padding: 4px 10px;
          border-radius: $size.radius.pill;
          background-color: $color.surface.sunken;
          color: $color.text.primary;
          /* The caller's block LAST, so what they send wins — which is what a slot is for. */
          ...$(this.props.css);
        )}
      >
        <span className={@@( ...$(this.props.labelCss); )}>{this.props.label}</span>
      </span>
    );
  }
}

export class StyleProp extends Component {
  @state loud = false;

  flip() {
    this.loud = !this.loud;
  }

  render() {
    return (
      <div className="panel">
        <div className={@@(display: flex; margin: $space.gutter.wide;)}>
          <strong>A prop that says what may be sent</strong>
          <button onclick={this.flip}>{this.loud ? "quiet" : "loud"}</button>
        </div>

        <div className={@@( display: flex; gap: $space.gutter.normal; flex-wrap: wrap; align-items: center; )}>
          {/* Nothing sent: the chip's own styles stand. */}
          <Chip label="plain" />

          {/* Inside the allow-list: a declared colour, and a hover colour. */}
          <Chip
            label="accent"
            css={@@(
              background-color: $color.accent.main;
              color: $color.surface.base;
              &:hover {
                background-color: $color.accent.quiet;
              }
            )}
          />

          {/* A condition picks between whole rules, so the static slot still takes it. */}
          <Chip
            label="label"
            labelCss={@@(
              font-weight: 400;
              when $(this.loud) {
                font-weight: 600;
              }
            )}
          />

          {/* Each of these is refused. Open one and read what the editor says.

              css={@@( background-color: #ff0055; )}             the value  — not a declared colour
              css={@@( padding: 2px; )}                          the property — not in the allow-list
              css={@@( &:focus { color: $color.text.muted; } )}          the state — not offered
              css={@@( & > span { color: $color.text.muted; } )}         a combinator — never offered
              labelCss={@@( letter-spacing: $(this.gap); )}         a runtime value in a static slot
          */}
        </div>
      </div>
    );
  }
}
