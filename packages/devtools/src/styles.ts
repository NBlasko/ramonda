/**
 * Every rule the panel draws itself with, lifted out of `render()`.
 *
 * It was 431 lines inside a template literal in the middle of a 2777-line class — the single
 * largest thing in the file, and the one with no logic in it at all. Reading the panel's behaviour
 * meant scrolling past all of it.
 *
 * A string rather than a constructed stylesheet: the panel writes its whole shadow root in one
 * `innerHTML` assignment, and a `CSSStyleSheet` would mean a second mechanism for one caller.
 *
 * Moved verbatim. The rendered shadow DOM is byte-identical before and after, which is what a
 * refactor with no behaviour in it has to be able to claim.
 */
export const PANEL_CSS = `
        @keyframes flash-green {
          0% { background: rgba(0, 255, 170, 0.5); }
          100% { background: transparent; }
        }
        .state-row.updated { animation: flash-green 0.8s ease-out; }
        .ramonda-badge {
          position: fixed; bottom: 20px; right: 20px;
          width: 50px; height: 50px; background: #7A4FBF; color: white;
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
          background: #111; color: #eee; z-index: 2147483647;
          box-shadow: -5px 0 25px rgba(0,0,0,0.5);
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          transform: translateX(100%); display: flex; flex-direction: column;
          border-left: 3px solid #7A4FBF; font-family: sans-serif;
        }
        :host([open]) .ramonda-panel { transform: translateX(0); }
        /* Grab-anywhere-on-the-edge: 8px wide, sitting half outside so the cursor changes just
           before the panel begins. touch-action none, or a pen/touch drag scrolls instead. */
        .ramonda-resize {
          position: absolute; top: 0; bottom: 0; left: -4px; width: 8px;
          cursor: ew-resize; z-index: 2; touch-action: none;
        }
        .ramonda-resize:hover, .ramonda-panel.resizing .ramonda-resize { background: #7A4FBF; }
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
          0%, 100% { box-shadow: 0 4px 15px rgba(0,0,0,.3), 0 0 0 0 rgba(255,68,68,.55); }
          50%      { box-shadow: 0 4px 15px rgba(0,0,0,.3), 0 0 0 10px rgba(255,68,68,0); }
        }

        .badge-spark { position: absolute; inset: 0; border-radius: 50%; opacity: 0; pointer-events: none; }
        .badge-count {
          position: absolute; top: -5px; right: -5px; min-width: 19px; height: 19px;
          padding: 0 4px; border-radius: 10px; background: #fff; color: #c0392b;
          font-size: 11.5px; font-weight: bold; line-height: 19px; text-align: center;
          box-shadow: 0 1px 4px rgba(0,0,0,.4); display: none;
        }
        :host(.has-errors) .badge-count { display: block; }
        :host(.has-errors) .ramonda-badge {
          background: #c0392b; animation: boom-breathe 2.4s ease-in-out infinite;
        }
        /* After the has-errors rule, so the burst wins while it is playing. */
        .ramonda-badge.boom { animation: boom-shake .8s cubic-bezier(.36,.07,.19,.97) both; }
        .ramonda-badge.boom::before, .ramonda-badge.boom::after {
          content: ""; position: absolute; inset: -7px; border-radius: 50%;
          border: 4px solid #ff4444; animation: boom-ring .95s ease-out both; pointer-events: none;
        }
        .ramonda-badge.boom::after { border-color: #E9B44C; animation-delay: .16s; }
        .ramonda-badge.boom .badge-spark {
          animation: boom-spark .9s ease-out both;
          box-shadow:
            0 -38px 0 -22px #ff4444, 27px -27px 0 -22px #E9B44C,
            38px 0 0 -22px #ff4444, 27px 27px 0 -22px #E9B44C,
            0 38px 0 -22px #ff4444, -27px 27px 0 -22px #E9B44C,
            -38px 0 0 -22px #ff4444, -27px -27px 0 -22px #E9B44C;
        }
        /* Someone who asked for less motion gets the colour and the count, and no burst. */
        @media (prefers-reduced-motion: reduce) {
          .ramonda-badge.boom, .ramonda-badge.boom .badge-spark { animation: none; }
          .ramonda-badge.boom::before, .ramonda-badge.boom::after { display: none; }
          :host(.has-errors) .ramonda-badge { animation: none; outline: 3px solid #ff4444; }
        }

        /* A fixed badge is not squeezed by the body margin, so while open it would sit ON the
           panel. The header's × closes it, and so does the keyboard shortcut. */
        :host([open]) .ramonda-badge { display: none; }
        .head-tools { display: flex; align-items: center; gap: 10px; }
        .mode-btn {
          background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.25); color: #fff;
          font: inherit; font-size: 12.5px; line-height: 1; padding: 5px 10px; border-radius: 5px;
          cursor: pointer; transition: .15s;
        }
        .mode-btn:hover { background: rgba(255,255,255,.26); }
        .mode-btn:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
        /* Shown only when the panel opened itself: the reader did not choose this layout, so it
           says why it is the one they got. */
        .mode-note { display: none; padding: 6px 20px; background: #2a2033; color: #E9B44C;
                     font-size: 12.5px; border-bottom: 1px solid #3a2d47; }
        :host([open].forced-float) .mode-note { display: block; }
        /* Floating: the panel covers the page instead of squeezing it, so nothing about the app's
           layout changes when it opens. A heavier shadow, because now it is above rather than
           beside. */
        :host(.floating) .ramonda-panel { box-shadow: -12px 0 40px rgba(0,0,0,.65); }
        .header { padding: 20px; background: #7A4FBF; color: white; display: flex; justify-content: space-between; align-items: center; }
        .log-item { position: relative; border-bottom: 1px solid #222; padding: 12px 30px 12px 0; font-family: monospace; }
        .delete-btn { position: absolute; right: 0; top: 12px; background: none; border: none; color: #666; cursor: pointer; font-size: 16px; }
        .delete-btn:hover { color: #ff4444; }
        .data-preview { background: #1a1a1a; padding: 8px; border-radius: 4px; margin-top: 8px; font-size: 13px; color: #00ffaa; max-height: 150px; overflow: auto; white-space: pre-wrap; cursor: pointer; }
        .tabs { display: flex; background: #1a1a1a; border-bottom: 1px solid #333; flex-shrink: 0; }
        .tab { flex: 1; padding: 10px; text-align: center; cursor: pointer; border-bottom: 2px solid transparent; color: #888; font-weight: bold; transition: 0.2s; }
        .tab.active { color: #B18AE6; border-bottom: 2px solid #B18AE6; background: #222; }
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
        .kind-component { background: #7A4FBF; color: #fff; }
        .kind-hook { background: #6a3; color: #fff; }
        .node-body { padding-left: 12px; border-left: 1px solid #333; margin-left: 5px; }
        /* 11px was unreadable, which is the whole point of this panel. */
        .state-block { background: #1a1a1a; padding: 8px 10px; margin: 6px 0; font-size: 14px;
                       line-height: 1.55; border-left: 2px solid #00ffaa; border-radius: 4px; }
        .state-title { color: #00ffaa; margin-bottom: 4px; font-weight: bold; font-size: 13px;
                       text-transform: uppercase; letter-spacing: .4px; }
        .state-row { margin: 2px 0; }
        /* One line for a scalar: the value sits with its key, and its buttons follow the value rather
           than the key, so a row reads key, value, then controls. */
        .state-row.one-line { display: flex; align-items: baseline; gap: 4px; }
        .state-row.one-line .sv { max-height: none; overflow: visible; padding: 0; min-width: 0; }
        .state-row.one-line .jv-row { display: inline; }
        .state-head { display: flex; gap: 4px; align-items: center; }
        .state-row .sk { color: #9a9aa2; flex-shrink: 0; font-family: ui-monospace, Menlo, monospace;
                         font-size: 14px; }

        /**
         * A long value is scrollable rather than truncated. The bridge still caps what it sends,
         * but what it sends should be readable in full — a value ending in "…" is the one you
         * needed to see.
         */
        /* A little air on the left: the first row of a tree pressed against the edge of its box
           reads as part of the frame, and the nesting has nothing to be measured against. */
        .state-row .sv { color: #eee; max-height: 16em; overflow: auto; padding: 2px 4px 2px 2px; }
        .state-row .sv::-webkit-scrollbar { width: 8px; }
        .state-row .sv::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 4px; }

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
        .tree-head { position: sticky; top: 0; z-index: 4; background: #171717; }
        .tools { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 20px; background: #171717;
                 border-bottom: 1px solid #2a2a2a; }
        .tools button { background: #262626; border: 1px solid #383838; color: #ccc; font: inherit;
                        font-size: 13px; padding: 4px 9px; border-radius: 5px; cursor: pointer; }
        .tools button:hover { background: #303030; color: #fff; }
        .tools button.on { background: #7A4FBF; border-color: #7A4FBF; color: #fff; }
        .tool-search { flex: 1 1 130px; min-width: 90px; background: #101010; border: 1px solid #383838;
                       color: #eee; font: inherit; font-size: 13px; padding: 4px 8px; border-radius: 5px; }
        .tool-search::placeholder { color: #666; }
        .tool-search:focus { outline: none; border-color: #7A4FBF; }

        .crumbs { display: none; align-items: center; flex-wrap: wrap; gap: 4px;
                  padding: 8px 20px; background: #14121a; border-bottom: 1px solid #2a2a2a; font-size: 13px; }
        .crumbs.on { display: flex; }
        .crumb { background: none; border: none; color: #9a8fb5; font: inherit; font-size: 13px;
                 padding: 2px 4px; border-radius: 4px; cursor: pointer; }
        .crumb:hover { background: #241f30; color: #fff; }
        .crumb.here { color: #B18AE6; font-weight: bold; cursor: default; }
        .crumb.gone { color: #ffcc00; cursor: default; }
        .crumb-sep { color: #555; }

        .pick-label {
          position: fixed; left: 0; top: 0; z-index: 2147483647; display: none;
          background: #7A4FBF; color: #fff; font-family: sans-serif; font-size: 13px;
          padding: 3px 7px; border-radius: 4px; pointer-events: none;
          box-shadow: 0 2px 8px rgba(0,0,0,.4); white-space: nowrap;
        }
        .pick-label.on { display: block; }

        .edit-btn { background: none; border: none; color: #4a4a4a; font: inherit; font-size: 13px;
                    padding: 0 4px; cursor: pointer; }
        .state-row:hover .edit-btn { color: #9a8fb5; }
        .edit-btn:hover { color: #00ffaa; }
        .edit-input {
          width: 100%; box-sizing: border-box; background: #0d0d0d; border: 1px solid #7A4FBF;
          border-radius: 4px; color: #eee; font-family: ui-monospace, Menlo, monospace;
          font-size: 13px; padding: 4px 6px; resize: vertical;
        }
        .edit-input:focus { outline: none; border-color: #B18AE6; }
        .edit-note { color: #8b8b93; font-size: 11.5px; margin-top: 3px; }
        .edit-note.bad { color: #ff8080; }

        .pin-btn, .src-btn { background: none; border: none; color: #4a4a4a; font: inherit;
                             font-size: 13px; padding: 0 4px; cursor: pointer; }
        .comp-summary:hover .pin-btn, .comp-summary:hover .src-btn { color: #9a8fb5; }
        .pin-btn:hover, .src-btn:hover { color: #B18AE6; }
        .src-btn { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }

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
        #components-container.filtering .component-node.hit > .comp-summary { background: rgba(122,79,191,.28); border-radius: 4px; }

        #components-container.no-values .state-block { display: none; }
        #components-container.no-hooks .kind-hook { opacity: .5; }
        #components-container.no-hooks .component-node:has(> details > summary .kind-hook),
        #components-container.no-hooks .component-node.leaf:has(.kind-hook) { display: none; }

        /* The value tree. Rows are dense on purpose — this is a listing, and vertical space is
           what you run out of first when a value has forty keys. */
        .jv { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; line-height: 1.55; }
        .jv-row, .jv-sum { white-space: pre-wrap; word-break: break-word; }
        .jv-node > .jv-body { padding-left: 14px; border-left: 1px solid #2c2c2c; margin-left: 4px; }
        .jv-sum { cursor: pointer; list-style: none; border-radius: 3px; }
        .jv-sum:hover { background: #1d1a24; }
        .jv-sum::-webkit-details-marker { display: none; }
        /* Our own triangle: the native marker cannot be coloured or sized, and at this font size
           it is the difference between seeing the nesting and guessing at it. */
        .jv-sum::before { content: "\\25B8"; color: #6a6a72; display: inline-block; width: 12px; }
        .jv-node[open] > .jv-sum::before { content: "\\25BE"; color: #B18AE6; }
        .jv-k { color: #9ecbff; }
        .jv-c { color: #6a6a72; }
        .jv-s { color: #7ee787; }
        .jv-n { color: #79c0ff; }
        .jv-b { color: #ffab70; }
        .jv-null { color: #8b8b93; font-style: italic; }
        .jv-f { color: #d2a8ff; }
        .jv-o { color: #e3b341; }
        .jv-meta { color: #8b8b93; }
        .jv-cut { color: #E9B44C; font-style: italic; }

        /* A chip rather than a bare glyph: it is a control, and on a row full of monospace text a
           button with no edges reads as punctuation. Dim until the row is hovered, so forty rows
           are not forty bright buttons. */
        .jv-open {
          background: #232028; border: 1px solid #322c3a; color: #6a6472;
          font: inherit; font-size: 12.5px; line-height: 1; padding: 2px 5px;
          border-radius: 4px; cursor: pointer; flex-shrink: 0; transition: .15s;
        }
        .state-row:hover .jv-open, .q-row:hover .jv-open { color: #b9aecd; border-color: #443a52; }
        .jv-open:hover { background: #7A4FBF; border-color: #7A4FBF; color: #fff; }
        .jv-open:focus-visible { outline: 2px solid #B18AE6; outline-offset: 1px; }

        /* One value on the whole panel: inside the panel, not over the page, so the app stays
           visible beside it and the tree behind keeps its place. */
        /* Above the sticky head and below the full value view — see the layer scale there. */
        .toast {
          position: absolute; left: 14px; right: 14px; bottom: 14px; z-index: 6;
          background: #241f30; border: 1px solid #7A4FBF; border-radius: 6px;
          color: #e8e2f2; font-size: 12.5px; line-height: 1.45; padding: 9px 12px;
          box-shadow: 0 6px 20px rgba(0,0,0,.5); opacity: 0; transform: translateY(6px);
          transition: opacity .18s ease, transform .18s ease; pointer-events: none;
          word-break: break-word;
        }
        .toast.on { opacity: 1; transform: translateY(0); }

        .jv-modal { position: absolute; inset: 0; background: #0d0d0d; z-index: 10;
                    display: none; flex-direction: column; }
        .jv-modal.on { display: flex; }
        .jv-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px;
                         padding: 10px 14px; background: #191622; border-bottom: 1px solid #2a2532; }
        .jv-modal-title { color: #B18AE6; font-family: ui-monospace, Menlo, monospace; font-size: 13px;
                          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .jv-modal-tools { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .jv-modal-tools button {
          background: #262230; border: 1px solid #383142; color: #cfc6dd;
          font: inherit; font-size: 13px; line-height: 1; padding: 5px 10px;
          border-radius: 5px; cursor: pointer; transition: .15s;
        }
        .jv-modal-tools button:hover { background: #322b3d; color: #fff; border-color: #4a4058; }
        .jv-modal-tools button:active { transform: translateY(1px); }
        .jv-modal-tools button:focus-visible { outline: 2px solid #B18AE6; outline-offset: 1px; }
        /* The raw switch is a toggle, so it has to LOOK held down when it is on — the same purple
           the toolbar filters use, so one visual language covers every toggle in the panel. */
        .jv-modal-tools button.on { background: #7A4FBF; border-color: #7A4FBF; color: #fff; }
        /**
         * The full view is a SNAPSHOT — it has to be, or the tree would move under the cursor while
         * you are four levels into it. But a snapshot that has quietly gone stale is a lie, so the
         * refresh button says which of the two you are looking at: dim while the value it was
         * opened with is still current, lit and pulsing once the app has written a different one.
         */
        #jv-refresh { opacity: .45; }
        #jv-refresh.stale {
          opacity: 1; background: #E9B44C; border-color: #E9B44C; color: #241f30; font-weight: bold;
          animation: jv-pulse 1.6s ease-out infinite;
        }
        #jv-refresh.stale:hover { background: #f3c463; border-color: #f3c463; color: #241f30; }
        #jv-refresh.gone { opacity: .8; color: #ff8080; border-color: #5c3040; }
        @keyframes jv-pulse {
          0% { box-shadow: 0 0 0 0 rgba(233,180,76,.55); }
          70% { box-shadow: 0 0 0 7px rgba(233,180,76,0); }
          100% { box-shadow: 0 0 0 0 rgba(233,180,76,0); }
        }
        /* Closing is the destructive one of the three, and it is the one hit by accident. */
        #jv-close { padding: 3px 9px; font-size: 17px; color: #8b8b93; background: none; border-color: transparent; }
        #jv-close:hover { background: #3a2230; border-color: #5c3040; color: #ff8080; }
        .jv-modal-body { flex: 1; overflow: auto; padding: 12px 14px; }
        .jv-raw { margin: 0; color: #d8d8d8; font-family: ui-monospace, Menlo, monospace;
                  font-size: 14px; line-height: 1.5; white-space: pre; }

        .profile-hint { color: #8b8b93; font-size: 12.5px; align-self: center; }
        #profile-record.on { background: #c0392b; border-color: #c0392b; color: #fff; }
        .p-row { border: 1px solid #333; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px;
                 background: #1c1c1c; }
        .p-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 13px; }
        .p-index { color: #8b8b93; font-variant-numeric: tabular-nums; }
        /* The number this framework's whole argument is about, so it is the one thing set in bold. */
        .p-ms { color: #E9B44C; font-weight: bold; font-variant-numeric: tabular-nums; }
        .p-builds { color: #9a9aa2; }
        .p-costs { margin-top: 5px; display: grid; grid-template-columns: auto 1fr auto; gap: 2px 8px;
                   font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; align-items: center; }
        .p-name { color: #B18AE6; white-space: nowrap; }
        .p-bar { background: #2a2233; border-radius: 3px; height: 9px; overflow: hidden; }
        .p-bar span { display: block; height: 100%; background: #7A4FBF; }
        .p-cost { color: #9a9aa2; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .p-empty { color: #8b8b93; font-size: 12.5px; line-height: 1.6; }

        .q-client { color: #888; font-size: 12.5px; text-transform: uppercase; letter-spacing: .5px; margin: 14px 0 6px; }
        .q-row { border: 1px solid #333; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; background: #1c1c1c; }
        .q-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        /* Same control, same place as in a component row: on the label of the value it opens. */
        .q-head .jv-open { margin-left: auto; }
        .q-status { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .q-key { color: #B18AE6; font-size: 13px; word-break: break-all; }
        .q-fetching { color: #00aaff; font-size: 12.5px; }
        .q-badge { color: #E9B44C; font-size: 11.5px; border: 1px solid #E9B44C; border-radius: 3px; padding: 0 4px; }
        .q-meta { color: #888; font-size: 12.5px; margin-top: 4px; }
        .q-obs { color: #54c98a; }
        .q-idle { color: #888; font-style: italic; }
        .q-error { color: #ff6b6b; font-size: 12.5px; margin-top: 4px; }
        /* Same treatment as a state value: scrollable, not clipped. */
        .q-data { color: #ccc; margin-top: 6px; max-height: 16em; overflow: auto; padding: 2px 4px 2px 2px; }
        .q-data::-webkit-scrollbar { width: 8px; }
        .q-data::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 4px; }
        .q-actions { display: flex; gap: 6px; margin-top: 8px; }
        .q-actions button { background: #2a2a2a; border: 1px solid #3a3a3a; color: #ccc; font-size: 12.5px; padding: 3px 8px; border-radius: 4px; cursor: pointer; }
        .q-actions button:hover { background: #333; color: #fff; }

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
