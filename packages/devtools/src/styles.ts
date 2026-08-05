import { declarations, iconMask, panel } from "@ramonda/theme";

/**
 * Every rule the panel draws itself with, lifted out of `render()`.
 *
 * A string rather than a constructed stylesheet: the panel writes its whole shadow root in one
 * `innerHTML` assignment, and a `CSSStyleSheet` would mean a second mechanism for one caller.
 *
 * ## The colours are named, and the names come from one place
 *
 * Every colour here is a `var(--rmd-*)` resolved by the block below, generated from
 * `@ramonda/theme`. Read that module to find out what a name means; change it there and the docs
 * site and the logo move with it.
 *
 * Two kinds of colour stayed literal, and neither is part of the palette: `rgba(0,0,0,…)` drop
 * shadows and `rgba(255,255,255,…)` highlights. Those are light and shade on whatever is underneath
 * rather than a colour anybody chose.
 *
 * A translucent token is written `rgb(from var(--rmd-error) r g b / .55)` rather than with
 * `color-mix`, and the difference is not cosmetic: `color-mix(… 0%, transparent)` resolves to
 * transparent BLACK, so the badge's spark rings would have faded through grey instead of through
 * their own colour. Relative colour syntax keeps the hue all the way to zero alpha.
 *
 * ## The block is on `:host`, not on `.ramonda-panel`
 *
 * Because the badge is a sibling of the panel, not a child of it — a token declared on the panel
 * would not reach the thing you click to open it. `:host` is the whole shadow root, and being inside
 * the shadow root is also what keeps these names from touching the page the panel is sitting on.
 */
export const PANEL_CSS = `
        .rmd-icon { vertical-align: -0.14em; flex: 0 0 auto; }
        :host {
${declarations(panel, "          ")}
        }
        @keyframes flash-green {
          0% { background: rgb(from var(--rmd-live) r g b / 0.5); }
          100% { background: transparent; }
        }
        .state-row.updated { animation: flash-green 0.8s ease-out; }
        .ramonda-badge {
          position: fixed; bottom: 20px; right: 20px;
          width: 50px; height: 50px; background: var(--rmd-brand); color: var(--rmd-text-strong);
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-weight: bold; font-size: 20px; cursor: grab; z-index: 2147483647;
          box-shadow: 0 4px 15px rgba(0,0,0,0.3); user-select: none; touch-action: none;
        }
        /**
         * The panel DOCKS: opening it puts a right margin on the body, so the app reflows into
         * what is left instead of sitting underneath.
         *
         * This is the fix for a whole class of problem rather than one annoyance. As an overlay,
         * highlighting a component often highlighted something the panel was covering — which is
         * why the drawer used to fade after a delay, and a panel that disappears while you read it
         * is its own kind of wrong. Nothing is behind the panel now, so there is nothing to fade,
         * and the highlight is simply visible.
         *
         * What it cannot squeeze: an element the app itself positions as fixed, and a layout pinned
         * to the full viewport width. Browser devtools has the same limit for the same reason, and
         * the drag handle is the answer when it bites.
         *
         * 620px sits between the original 450 and the 900 that covered too much. It is only a
         * STARTING width — the left edge is a drag handle and the choice is remembered.
         */
        .ramonda-panel {
          position: fixed; top: 0; right: 0; width: var(--panel-w, min(620px, 92vw)); height: 100vh;
          min-width: 280px; max-width: 96vw;
          container-type: inline-size;
          background: var(--rmd-surface); color: var(--rmd-text-bright); z-index: 2147483647;
          box-shadow: -5px 0 25px rgba(0,0,0,0.5);
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          transform: translateX(100%); display: flex; flex-direction: column;
          border-left: 3px solid var(--rmd-brand); font-family: var(--rmd-sans);
        }
        :host([open]) .ramonda-panel { transform: translateX(0); }
        /* Grab-anywhere-on-the-edge: 8px wide, sitting half outside so the cursor changes just
           before the panel begins. touch-action none, or a pen/touch drag scrolls instead. */
        .ramonda-resize {
          position: absolute; top: 0; bottom: 0; left: -4px; width: 8px;
          cursor: ew-resize; z-index: 2; touch-action: none;
        }
        .ramonda-resize:hover, .ramonda-panel.resizing .ramonda-resize { background: var(--rmd-brand); }
        /* While dragging, the pointer is over the app, not the handle — without this every
           move selects a paragraph behind the panel. */
        .ramonda-panel.resizing { user-select: none; }
        /**
         * A dev error detonates the badge.
         *
         * It has to be unmissable, because it no longer opens anything: a shake that overshoots in
         * both directions, two rings expanding out of the badge, and a spray of sparks — eight dots
         * thrown outwards with box-shadow, which needs no extra elements and no JS per frame.
         *
         * Then it settles into a red badge with a count, breathing slowly. The burst says "now",
         * the breathing says "still". A permanent burst would be unbearable in a session with a
         * hundred diagnostics, and no persistent state at all would mean an error you glanced away
         * from never happened.
         */
        @keyframes boom-shake {
          0%   { transform: scale(1) rotate(0); }
          12%  { transform: scale(1.5) rotate(-9deg); }
          26%  { transform: scale(.9) rotate(8deg); }
          42%  { transform: scale(1.25) rotate(-6deg); }
          60%  { transform: scale(.97) rotate(4deg); }
          78%  { transform: scale(1.08) rotate(-2deg); }
          100% { transform: scale(1) rotate(0); }
        }
        @keyframes boom-ring {
          0%   { opacity: .95; transform: scale(.55); border-width: 4px; }
          100% { opacity: 0; transform: scale(2.9); border-width: 1px; }
        }
        @keyframes boom-spark {
          0%   { opacity: 1; transform: scale(.15); }
          65%  { opacity: .9; }
          100% { opacity: 0; transform: scale(2.1); }
        }
        @keyframes boom-breathe {
          0%, 100% { box-shadow: 0 4px 15px rgba(0,0,0,.3), 0 0 0 0 rgb(from var(--rmd-error) r g b / .55); }
          50%      { box-shadow: 0 4px 15px rgba(0,0,0,.3), 0 0 0 10px rgb(from var(--rmd-error) r g b / 0); }
        }

        .badge-spark { position: absolute; inset: 0; border-radius: 50%; opacity: 0; pointer-events: none; }
        .badge-count {
          position: absolute; top: -5px; right: -5px; min-width: 19px; height: 19px;
          padding: 0 4px; border-radius: 10px; background: var(--rmd-text-strong); color: var(--rmd-error-deep);
          font-size: 11.5px; font-weight: bold; line-height: 19px; text-align: center;
          box-shadow: 0 1px 4px rgba(0,0,0,.4); display: none;
        }
        :host(.has-errors) .badge-count { display: block; }
        :host(.has-errors) .ramonda-badge {
          background: var(--rmd-error-deep); animation: boom-breathe 2.4s ease-in-out infinite;
        }
        /* After the has-errors rule, so the burst wins while it is playing. */
        .ramonda-badge.boom { animation: boom-shake .8s cubic-bezier(.36,.07,.19,.97) both; }
        .ramonda-badge.boom::before, .ramonda-badge.boom::after {
          content: ""; position: absolute; inset: -7px; border-radius: 50%;
          border: 4px solid var(--rmd-error); animation: boom-ring .95s ease-out both; pointer-events: none;
        }
        .ramonda-badge.boom::after { border-color: var(--rmd-gold); animation-delay: .16s; }
        .ramonda-badge.boom .badge-spark {
          animation: boom-spark .9s ease-out both;
          box-shadow:
            0 -38px 0 -22px var(--rmd-error), 27px -27px 0 -22px var(--rmd-gold),
            38px 0 0 -22px var(--rmd-error), 27px 27px 0 -22px var(--rmd-gold),
            0 38px 0 -22px var(--rmd-error), -27px 27px 0 -22px var(--rmd-gold),
            -38px 0 0 -22px var(--rmd-error), -27px -27px 0 -22px var(--rmd-gold);
        }
        /* Someone who asked for less motion gets the colour and the count, and no burst. */
        @media (prefers-reduced-motion: reduce) {
          .ramonda-badge.boom, .ramonda-badge.boom .badge-spark { animation: none; }
          .ramonda-badge.boom::before, .ramonda-badge.boom::after { display: none; }
          :host(.has-errors) .ramonda-badge { animation: none; outline: 3px solid var(--rmd-error); }
        }

        /* A fixed badge is not squeezed by the body margin, so while open it would sit ON the
           panel. The header's × closes it, and so does the keyboard shortcut. */
        :host([open]) .ramonda-badge { display: none; }
        .head-tools { display: flex; align-items: center; gap: 10px; }
        .mode-btn {
          background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.25); color: var(--rmd-text-strong);
          font: inherit; font-size: 12.5px; line-height: 1; padding: 5px 10px; border-radius: 5px;
          cursor: pointer; transition: .15s;
        }
        .mode-btn:hover { background: rgba(255,255,255,.26); }
        .mode-btn:focus-visible { outline: 2px solid var(--rmd-text-strong); outline-offset: 1px; }
        /* Shown only when the panel opened itself: the reader did not choose this layout, so it
           says why it is the one they got. */
        .mode-note { display: none; padding: 6px 20px; background: var(--rmd-tint); color: var(--rmd-gold);
                     font-size: 12.5px; border-bottom: 1px solid var(--rmd-tint-control); }
        :host([open].forced-float) .mode-note { display: block; }
        /* Floating: the panel covers the page instead of squeezing it, so nothing about the app's
           layout changes when it opens. A heavier shadow, because now it is above rather than
           beside. */
        :host(.floating) .ramonda-panel { box-shadow: -12px 0 40px rgba(0,0,0,.65); }
        .header { padding: 20px; background: var(--rmd-brand); color: var(--rmd-text-strong); display: flex; justify-content: space-between; align-items: center; }
        .log-item { position: relative; border-bottom: 1px solid var(--rmd-control); padding: 12px 30px 12px 0; font-family: var(--rmd-mono); }
        .delete-btn { position: absolute; right: 0; top: 12px; background: none; border: none; color: var(--rmd-text-faint); cursor: pointer; font-size: 16px; }
        .delete-btn:hover { color: var(--rmd-error); }
        .data-preview { background: var(--rmd-surface-raised); padding: 8px; border-radius: 4px; margin-top: 8px; font-size: 13px; color: var(--rmd-live); max-height: 150px; overflow: auto; white-space: pre-wrap; cursor: pointer; }
        .tabs { display: flex; background: var(--rmd-surface-raised); border-bottom: 1px solid var(--rmd-border); flex-shrink: 0; }
        .tab { flex: 1; padding: 10px; text-align: center; cursor: pointer; border-bottom: 2px solid transparent; color: var(--rmd-text-muted); font-weight: bold; transition: 0.2s; }
        .tab.active { color: var(--rmd-brand-light); border-bottom: 2px solid var(--rmd-brand-light); background: var(--rmd-control); }
        /* overflow auto on BOTH axes, because the panel is now as narrow as the reader wants
           it: a deep tree row or a wide query key must be reachable by scrolling rather than
           be reflowed into something unreadable. */
        .tab-content { display: none; padding: 20px; overflow: auto; flex-grow: 1; }
        .tab-content.active { display: block; }
        .component-node { margin-top: 4px; }
        /* Never wrapped: at 300px a nested &lt;ProductDetail /&gt; row would otherwise break across
           lines and the indentation — the only thing telling you where you are — would be lost.
           The row extends past the edge instead, and the tab content scrolls to it. */
        .comp-summary { outline: none; cursor: pointer; white-space: nowrap; }
        .kind-badge { font-size: 10.5px; padding: 1px 4px; border-radius: 3px; margin-right: 5px; vertical-align: middle; }
        .kind-component { background: var(--rmd-brand); color: var(--rmd-text-strong); }
        .kind-hook { background: var(--rmd-hook); color: var(--rmd-text-strong); }
        .node-body { padding-left: 12px; border-left: 1px solid var(--rmd-border); margin-left: 5px; }
        /* 11px was unreadable, which is the whole point of this panel. */
        .state-block { background: var(--rmd-surface-raised); padding: 8px 10px; margin: 6px 0; font-size: 14px;
                       line-height: 1.55; border-left: 2px solid var(--rmd-live); border-radius: 4px; }
        .state-title { color: var(--rmd-live); margin-bottom: 4px; font-weight: bold; font-size: 13px;
                       text-transform: uppercase; letter-spacing: .4px; }
        .state-row { margin: 2px 0; }
        /* One line for a scalar: the value sits with its key, and its buttons follow the value rather
           than the key, so a row reads key, value, then controls. */
        .state-row.one-line { display: flex; align-items: baseline; gap: 4px; }
        .state-row.one-line .sv { max-height: none; overflow: visible; padding: 0; min-width: 0; }
        .state-row.one-line .jv-row { display: inline; }
        .state-head { display: flex; gap: 4px; align-items: center; }
        .state-row .sk { color: var(--rmd-text-dim); flex-shrink: 0; font-family: var(--rmd-mono);
                         font-size: 14px; }

        /**
         * A long value is scrollable rather than truncated. The bridge still caps what it sends,
         * but what it sends should be readable in full — a value ending in "…" is the one you
         * needed to see.
         */
        /* A little air on the left: the first row of a tree pressed against the edge of its box
           reads as part of the frame, and the nesting has nothing to be measured against. */
        .state-row .sv { color: var(--rmd-text-bright); max-height: 16em; overflow: auto; padding: 2px 4px 2px 2px; }
        .state-row .sv::-webkit-scrollbar { width: 8px; }
        .state-row .sv::-webkit-scrollbar-thumb { background: var(--rmd-border-strong); border-radius: 4px; }

        .component-node.leaf .comp-summary { padding-left: 13px; }

        /**
         * The controls stay on screen while the tree scrolls under them.
         *
         * They are how you FIND a component, and they were at the top of a scrolling column — so
         * the moment you found something and scrolled to read it, the search you used to find it
         * was gone. Sticky needs a scroll container with no padding of its own, which is why the
         * padding moved onto the tree below.
         */
        #components-tab { padding: 0; }
        #components-container { padding: 12px 20px 20px; }
        /**
         * The layers inside the panel, and the order is the whole point:
         *
         *   2  the resize handle, over the panel's own edge
         *   4  the sticky tree head, over the tree scrolling under it
         *   10 the full value view, over EVERYTHING — it is the thing you opened
         *
         * The head was 4 and the value view was 3, which is exactly the bug you found: opening a
         * value drew the toolbar and the breadcrumb on top of it and cut the tree off two rows in.
         * The gap to 10 is deliberate, so the next sticky thing added to the panel cannot climb
         * over the modal by accident.
         */
        .tree-head { position: sticky; top: 0; z-index: 4; background: var(--rmd-surface-raised); }
        .tools { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 20px; background: var(--rmd-surface-raised);
                 border-bottom: 1px solid var(--rmd-control); }
        .tools button { background: var(--rmd-control); border: 1px solid var(--rmd-border); color: var(--rmd-text); font: inherit;
                        font-size: 13px; padding: 4px 9px; border-radius: 5px; cursor: pointer; }
        .tools button:hover { background: var(--rmd-control-hover); color: var(--rmd-text-strong); }
        .tools button.on { background: var(--rmd-brand); border-color: var(--rmd-brand); color: var(--rmd-text-strong); }
        .tool-search { flex: 1 1 130px; min-width: 90px; background: var(--rmd-surface-sunken); border: 1px solid var(--rmd-border);
                       color: var(--rmd-text-bright); font: inherit; font-size: 13px; padding: 4px 8px; border-radius: 5px; }
        .tool-search::placeholder { color: var(--rmd-text-faint); }
        .tool-search:focus { outline: none; border-color: var(--rmd-brand); }

        .crumbs { display: none; align-items: center; flex-wrap: wrap; gap: 4px;
                  padding: 8px 20px; background: var(--rmd-tint-deep); border-bottom: 1px solid var(--rmd-control); font-size: 13px; }
        .crumbs.on { display: flex; }
        .crumb { background: none; border: none; color: var(--rmd-text-tint); font: inherit; font-size: 13px;
                 padding: 2px 4px; border-radius: 4px; cursor: pointer; }
        .crumb:hover { background: var(--rmd-tint); color: var(--rmd-text-strong); }
        .crumb.here { color: var(--rmd-brand-light); font-weight: bold; cursor: default; }
        .crumb.gone { color: var(--rmd-warn); cursor: default; }
        .crumb-sep { color: var(--rmd-text-separator); }

        .pick-label {
          position: fixed; left: 0; top: 0; z-index: 2147483647; display: none;
          background: var(--rmd-brand); color: var(--rmd-text-strong); font-family: var(--rmd-sans); font-size: 13px;
          padding: 3px 7px; border-radius: 4px; pointer-events: none;
          box-shadow: 0 2px 8px rgba(0,0,0,.4); white-space: nowrap;
        }
        .pick-label.on { display: block; }

        .edit-btn { background: none; border: none; color: var(--rmd-text-faintest); font: inherit; font-size: 13px;
                    padding: 0 4px; cursor: pointer; }
        .state-row:hover .edit-btn { color: var(--rmd-text-tint); }
        .edit-btn:hover { color: var(--rmd-live); }
        .edit-input {
          width: 100%; box-sizing: border-box; background: var(--rmd-surface-sunken); border: 1px solid var(--rmd-brand);
          border-radius: 4px; color: var(--rmd-text-bright); font-family: var(--rmd-mono);
          font-size: 13px; padding: 4px 6px; resize: vertical;
        }
        .edit-input:focus { outline: none; border-color: var(--rmd-brand-light); }
        .edit-note { color: var(--rmd-text-muted); font-size: 11.5px; margin-top: 3px; }
        .edit-note.bad { color: var(--rmd-error-soft); }

        .pin-btn, .src-btn { background: none; border: none; color: var(--rmd-text-faintest); font: inherit;
                             font-size: 13px; padding: 0 4px; cursor: pointer; }
        .comp-summary:hover .pin-btn, .comp-summary:hover .src-btn { color: var(--rmd-text-tint); }
        .pin-btn:hover, .src-btn:hover { color: var(--rmd-brand-light); }
        .src-btn { font-family: var(--rmd-mono); font-size: 12px; }

        /**
         * Filtering hides a branch with no match in it. The :has() rule keeps the ancestors of a
         * match, which is what makes the result readable as a TREE rather than as a flat list —
         * you see where the thing you searched for lives.
         *
         * State and props go away while filtering on purpose: a search is for finding, and they
         * are what you scroll past while looking. Focus the component and they are all back.
         */
        #components-container.filtering .component-node { display: none; }
        #components-container.filtering .component-node.hit,
        #components-container.filtering .component-node:has(.hit) { display: block; }
        #components-container.filtering .state-block { display: none; }
        #components-container.filtering .component-node.hit > details > .comp-summary,
        #components-container.filtering .component-node.hit > .comp-summary { background: rgb(from var(--rmd-brand) r g b / .28); border-radius: 4px; }

        #components-container.no-values .state-block { display: none; }
        #components-container.no-hooks .kind-hook { opacity: .5; }
        #components-container.no-hooks .component-node:has(> details > summary .kind-hook),
        #components-container.no-hooks .component-node.leaf:has(.kind-hook) { display: none; }

        /* The value tree. Rows are dense on purpose — this is a listing, and vertical space is
           what you run out of first when a value has forty keys. */
        .jv { font-family: var(--rmd-mono); font-size: 14px; line-height: 1.55; }
        .jv-row, .jv-sum { white-space: pre-wrap; word-break: break-word; }
        .jv-node > .jv-body { padding-left: 14px; border-left: 1px solid var(--rmd-control); margin-left: 4px; }
        .jv-sum { cursor: pointer; list-style: none; border-radius: 3px; }
        .jv-sum:hover { background: var(--rmd-tint-sunken); }
        .jv-sum::-webkit-details-marker { display: none; }
        /* Our own triangle: the native marker cannot be coloured or sized, and at this font size
           it is the difference between seeing the nesting and guessing at it. */
        .jv-sum::before {
          content: ""; display: inline-block; width: 12px; height: 12px; flex: 0 0 12px;
          background-color: var(--rmd-syntax-punct);
          mask: ${iconMask("caretRight")} center / 11px 11px no-repeat;
        }
        .jv-node[open] > .jv-sum::before {
          background-color: var(--rmd-brand-light);
          mask-image: ${iconMask("caretDown")};
        }
        .jv-k { color: var(--rmd-syntax-key); }
        .jv-c { color: var(--rmd-syntax-punct); }
        .jv-s { color: var(--rmd-syntax-string); }
        .jv-n { color: var(--rmd-syntax-number); }
        .jv-b { color: var(--rmd-syntax-boolean); }
        .jv-null { color: var(--rmd-syntax-null); font-style: italic; }
        .jv-f { color: var(--rmd-syntax-function); }
        .jv-o { color: var(--rmd-syntax-other); }
        .jv-meta { color: var(--rmd-text-muted); }
        .jv-cut { color: var(--rmd-gold); font-style: italic; }

        /* A chip rather than a bare glyph: it is a control, and on a row full of monospace text a
           button with no edges reads as punctuation. Dim until the row is hovered, so forty rows
           are not forty bright buttons. */
        .jv-open {
          background: var(--rmd-control); border: 1px solid var(--rmd-tint-raised); color: var(--rmd-text-punct);
          font: inherit; font-size: 12.5px; line-height: 1; padding: 2px 5px;
          border-radius: 4px; cursor: pointer; flex-shrink: 0; transition: .15s;
        }
        .state-row:hover .jv-open, .q-row:hover .jv-open { color: var(--rmd-text-tint-hover); border-color: var(--rmd-tint-border); }
        .jv-open:hover { background: var(--rmd-brand); border-color: var(--rmd-brand); color: var(--rmd-text-strong); }
        .jv-open:focus-visible { outline: 2px solid var(--rmd-brand-light); outline-offset: 1px; }

        /* One value on the whole panel: inside the panel, not over the page, so the app stays
           visible beside it and the tree behind keeps its place. */
        /* Above the sticky head and below the full value view — see the layer scale there. */
        .toast {
          position: absolute; left: 14px; right: 14px; bottom: 14px; z-index: 6;
          background: var(--rmd-tint); border: 1px solid var(--rmd-brand); border-radius: 6px;
          color: var(--rmd-text-tint-brightest); font-size: 12.5px; line-height: 1.45; padding: 9px 12px;
          box-shadow: 0 6px 20px rgba(0,0,0,.5); opacity: 0; transform: translateY(6px);
          transition: opacity .18s ease, transform .18s ease; pointer-events: none;
          word-break: break-word;
        }
        .toast.on { opacity: 1; transform: translateY(0); }

        .jv-modal { position: absolute; inset: 0; background: var(--rmd-surface-sunken); z-index: 10;
                    display: none; flex-direction: column; }
        .jv-modal.on { display: flex; }
        .jv-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px;
                         padding: 10px 14px; background: var(--rmd-tint-sunken); border-bottom: 1px solid var(--rmd-tint); }
        .jv-modal-title { color: var(--rmd-brand-light); font-family: var(--rmd-mono); font-size: 13px;
                          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .jv-modal-tools { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .jv-modal-tools button {
          background: var(--rmd-tint); border: 1px solid var(--rmd-tint-control); color: var(--rmd-text-tint-bright);
          font: inherit; font-size: 13px; line-height: 1; padding: 5px 10px;
          border-radius: 5px; cursor: pointer; transition: .15s;
        }
        .jv-modal-tools button:hover { background: var(--rmd-tint-raised); color: var(--rmd-text-strong); border-color: var(--rmd-tint-border); }
        .jv-modal-tools button:active { transform: translateY(1px); }
        .jv-modal-tools button:focus-visible { outline: 2px solid var(--rmd-brand-light); outline-offset: 1px; }
        /* The raw switch is a toggle, so it has to LOOK held down when it is on — the same purple
           the toolbar filters use, so one visual language covers every toggle in the panel. */
        .jv-modal-tools button.on { background: var(--rmd-brand); border-color: var(--rmd-brand); color: var(--rmd-text-strong); }
        /**
         * The full view is a SNAPSHOT — it has to be, or the tree would move under the cursor while
         * you are four levels into it. But a snapshot that has quietly gone stale is a lie, so the
         * refresh button says which of the two you are looking at: dim while the value it was
         * opened with is still current, lit and pulsing once the app has written a different one.
         */
        #jv-refresh { opacity: .45; }
        #jv-refresh.stale {
          opacity: 1; background: var(--rmd-gold); border-color: var(--rmd-gold); color: var(--rmd-tint); font-weight: bold;
          animation: jv-pulse 1.6s ease-out infinite;
        }
        #jv-refresh.stale:hover { background: var(--rmd-gold-hover); border-color: var(--rmd-gold-hover); color: var(--rmd-tint); }
        #jv-refresh.gone { opacity: .8; color: var(--rmd-error-soft); border-color: var(--rmd-error-border); }
        @keyframes jv-pulse {
          0% { box-shadow: 0 0 0 0 rgb(from var(--rmd-gold) r g b / .55); }
          70% { box-shadow: 0 0 0 7px rgb(from var(--rmd-gold) r g b / 0); }
          100% { box-shadow: 0 0 0 0 rgb(from var(--rmd-gold) r g b / 0); }
        }
        /* Closing is the destructive one of the three, and it is the one hit by accident. */
        #jv-close { padding: 3px 9px; font-size: 17px; color: var(--rmd-text-muted); background: none; border-color: transparent; }
        #jv-close:hover { background: var(--rmd-error-surface); border-color: var(--rmd-error-border); color: var(--rmd-error-soft); }
        .jv-modal-body { flex: 1; overflow: auto; padding: 12px 14px; }
        .jv-raw { margin: 0; color: var(--rmd-text); font-family: var(--rmd-mono);
                  font-size: 14px; line-height: 1.5; white-space: pre; }

        .profile-hint { color: var(--rmd-text-muted); font-size: 12.5px; align-self: center; }
        #profile-record.on { background: var(--rmd-error-deep); border-color: var(--rmd-error-deep); color: var(--rmd-text-strong); }
        .p-row { border: 1px solid var(--rmd-border); border-radius: 6px; padding: 8px 10px; margin-bottom: 6px;
                 background: var(--rmd-surface-raised); }
        .p-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 13px; }
        .p-index { color: var(--rmd-text-muted); font-variant-numeric: tabular-nums; }
        /* The number this framework's whole argument is about, so it is the one thing set in bold. */
        .p-ms { color: var(--rmd-gold); font-weight: bold; font-variant-numeric: tabular-nums; }
        .p-builds { color: var(--rmd-text-dim); }
        .p-costs { margin-top: 5px; display: grid; grid-template-columns: auto 1fr auto; gap: 2px 8px;
                   font-family: var(--rmd-mono); font-size: 12.5px; align-items: center; }
        .p-name { color: var(--rmd-brand-light); white-space: nowrap; }
        .p-bar { background: var(--rmd-tint); border-radius: 3px; height: 9px; overflow: hidden; }
        .p-bar span { display: block; height: 100%; background: var(--rmd-brand); }
        .p-cost { color: var(--rmd-text-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .p-empty { color: var(--rmd-text-muted); font-size: 12.5px; line-height: 1.6; }

        .q-client { color: var(--rmd-text-muted); font-size: 12.5px; text-transform: uppercase; letter-spacing: .5px; margin: 14px 0 6px; }
        .q-row { border: 1px solid var(--rmd-border); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; background: var(--rmd-surface-raised); }
        .q-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        /* Same control, same place as in a component row: on the label of the value it opens. */
        .q-head .jv-open { margin-left: auto; }
        .q-status { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .q-key { color: var(--rmd-brand-light); font-size: 13px; word-break: break-all; }
        .q-fetching { color: var(--rmd-busy); font-size: 12.5px; }
        .q-badge { color: var(--rmd-gold); font-size: 11.5px; border: 1px solid var(--rmd-gold); border-radius: 3px; padding: 0 4px; }
        .q-meta { color: var(--rmd-text-muted); font-size: 12.5px; margin-top: 4px; }
        .q-obs { color: var(--rmd-ok); }
        .q-idle { color: var(--rmd-text-muted); font-style: italic; }
        .q-error { color: var(--rmd-error-text); font-size: 12.5px; margin-top: 4px; }
        /* Same treatment as a state value: scrollable, not clipped. */
        .q-data { color: var(--rmd-text); margin-top: 6px; max-height: 16em; overflow: auto; padding: 2px 4px 2px 2px; }
        .q-data::-webkit-scrollbar { width: 8px; }
        .q-data::-webkit-scrollbar-thumb { background: var(--rmd-border-strong); border-radius: 4px; }
        .q-actions { display: flex; gap: 6px; margin-top: 8px; }
        .q-actions button { background: var(--rmd-control); border: 1px solid var(--rmd-border-strong); color: var(--rmd-text); font-size: 12.5px; padding: 3px 8px; border-radius: 4px; cursor: pointer; }
        .q-actions button:hover { background: var(--rmd-border); color: var(--rmd-text-strong); }

        /**
         * Narrow-panel layout, driven by a CONTAINER query rather than a media query.
         *
         * The width here is the reader's, set by dragging — the window may be 2560px wide while
         * the panel is 300px. A media rule would read the window and never fire.
         */
        @container (max-width: 440px) {
          .header { padding: 12px 14px; }
          .header h2 { font-size: 15px; }
          .tab { padding: 9px 4px; font-size: 12.5px; }
          .tab-content { padding: 12px 14px; }
          .tools { padding: 7px 14px; gap: 5px; }
          .crumbs { padding: 7px 14px; }
          .tools button { font-size: 12.5px; padding: 3px 7px; }
          .q-row { padding: 8px 10px; }
        }
        @container (max-width: 320px) {
          /* Every control keeps its icon and drops its words — four buttons still fit a row. */
          .tools button { flex: 1 1 auto; }
          .tools button .tw { display: none; }
        }
      `;
