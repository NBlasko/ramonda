# Third-party notices — @ramonda/devtools

This package is MIT, and its licence is in `LICENSE`. It also DISTRIBUTES a small piece of somebody
else's work, and this file is the notice that has to travel with it.

The icons are written in `@ramonda/theme`, which is not published; the panel that draws them is
bundled into this package's `dist`, so the paths ship here. That is why the notice lives here rather
than only at the root of the repository, where `THIRD-PARTY.md` lists everything the repository
takes from anywhere.

---

## Phosphor Icons — MIT

**What was taken:** thirteen SVG `<path>` `d` strings, regular weight, about 3 kB, copied into
`packages/theme/src/index.ts`. The reason they are copied rather than depended on is written beside
them: the package they come from carries nine thousand icons, and a development dependency on it
would put nine thousand icons in the graph so that a panel can draw a pencil.

https://phosphoricons.com

```
MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
