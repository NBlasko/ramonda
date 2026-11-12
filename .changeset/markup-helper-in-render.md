---
"@ramonda/check": minor
"create-ramonda": patch
---

New rule, `markup-helper-in-render`: a function that returns markup, built inside `render()` and only called there — `const head = (key) => <th>{key}</th>` called once per column — is reported, with the method to write instead. It is a new closure on every render and a piece of the rendering no subclass, test or devtools panel can reach. A row callback handed to `list()` or `map()`, inline or lifted into a local, is not reported. Found by the second trial; zero findings across this repository's own apps and packages. The scaffolded `AGENTS.md` lists it among the rules that are easy to break.
