---
"@ramonda/core": patch
---

A controlled radio group follows the model too

Radios have a rule of their own — checking one unchecks its group, and the browser does that itself —
so a click the app never accepted has to be undone by the model. The attribute cannot do it, for the
same dirty-checkedness reason a single checkbox cannot. Now tested alongside the rest: picking a third
option while the model says the second puts it back on the next render.
