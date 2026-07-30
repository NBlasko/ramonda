---
"@ramonda/core": minor
"@ramonda/devtools": minor
---

`</>` on any row in devtools opens that component's definition in your editor.

This closes the flow the navigation work was for. You could already point at something on the page,
find its component and focus it — and then you alt-tabbed and searched for the class by name. That
was the last manual step, and the most frequent one.

**Where the location comes from, and why it needs nothing from you.** The framework reads it off the
stack the first time a component or hook is constructed. That was measured before it was built on: a
subclass appears in a stack by name even when it declares no constructor of its own, and the frame's
position is the class declaration. So there is no build plugin to install, no JSX transform to switch
to, and no decorator a component has to carry — a bare `class Foo extends Component` is located like
any other. One `Error` per class, cached, in a development build only.

The alternatives were each worse: a JSX transform gives the call site (`<Foo />`) rather than the
definition, and esbuild only injects source for the automatic runtime, which this framework does not
use; a build plugin would be accurate and would also be a thing every app has to configure.

**Opening goes through the dev server**, not through a `vscode://` link: Vite's `/__open-in-editor`
hands the file to whatever editor is running on the machine that serves the app, so nothing has to be
registered or configured, and the browser never needs the absolute path. Without that endpoint — a
custom server — the location is copied to the clipboard and the log says so, because a button that
silently does nothing is worse than one that hands you something to paste.

**The position is resolved through the module's own sourcemap**, and that turned out not to be
optional. A stack reports the file the engine loaded, and `Error.stack` is never sourcemapped
(browsers apply sourcemaps when *displaying* a stack, never in the string). Measured against Vite 7
serving a real page: a class declared on **source line 20** appears on **served line 51**, because
esbuild lowers standard decorators and prepends a preamble. Thirty-one lines is not a rounding error
— it is a button that looks broken.

Vite serves each module with an inline map, so the map is already in the file the browser has
cached: fetch the module, decode the mappings, look up the segment. Verified end to end against a
live dev server — served 51 → source 20, exactly the declaration. The file name comes from the map
too, which is what keeps a bundled development build from opening the bundle instead of the source.
Everything fails towards the unresolved position, which still opens the right file.
