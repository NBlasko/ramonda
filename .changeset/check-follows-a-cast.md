---
"@ramonda/check": patch
---

A component or a hook under another name is followed through a cast: `const Link = LinkImpl as unknown as …` used as `<Link />`, and `const Hook = Counter as unknown as typeof Counter` used as `this.use(Hook)`, resolve to the class instead of being reported as a hole. `this.use(Named)` with `const Named = Counter` is followed too, as a tag already was. A cast changes a type, never which class the value is, and it is how `@ramonda/router` exports `Link` and `Navigator`.
