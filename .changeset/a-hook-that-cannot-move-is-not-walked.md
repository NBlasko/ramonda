---
"@ramonda/core": patch
---

In a production build, a hook whose props can never change — its callback read no signal, or it takes no props
— and that has no hook of its own is left off its owner's walk, so an owner's render no longer calls it or builds
it an empty props object. What a hook sees is unchanged. A hook that gains a hook of its own later is walked again.
