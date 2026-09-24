---
"@ramonda/css": patch
---

A leftover diagnostic test is gone from `viteBuild.test.ts`, and the gate that exists to catch that
shape now sees it.

`test("zzdiagnose")` built a whole Vite production bundle, wrote what it found to `/tmp/zzdiag.txt`,
and asserted only what the test above it already asserted. It printed nothing, so
`check-test-probes.mjs` — which exists because a probe once survived into *this same file* through a
green gate — had no reason to speak, and it rode through every run since it was committed.

The gate reads string literals now as well as calls: a path typed into a test that points into the
system temp directory is a person watching a file while they debug. A test that needs a temporary
file makes one with `mkdtempSync(join(tmpdir(), …))` and removes it, which is what every fixture
here already does. `SELFTEST=scratch` proves the new half can fail.
