---
"@ramonda/core": minor
"create-ramonda": minor
---

**Breaking:** `Ref` is exported as a type only. `createRef()` is the one way to make a ref — `new Ref()`
was a second way that skipped both the development report for a ref built where it cannot be kept and
`ramonda-check`'s `ref-built-where-it-cannot-be-kept`. Replace `new Ref<T>()` with `createRef<T>()`;
`Ref<T>` as an annotation is unchanged.
