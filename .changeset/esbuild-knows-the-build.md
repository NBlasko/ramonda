---
"@ramonda/css": patch
---

The esbuild adapter knows which build it is running, so a config that depends on the environment is
honoured.

A config may be written `env.production ? ["px"] : ["px", "rem"]` — that dependence is the whole
reason it is TypeScript rather than JSON. Vite is handed its mode and passes it on; the esbuild
adapter read `NODE_ENV` alone, on the reasoning that esbuild is not told which build it is. It is
told, twice. Measured, the same config and the same block:

```
vite,    --mode production, NODE_ENV unset    refused
esbuild, minify: true,      NODE_ENV unset    BUILT — `2rem` went in
```

So a project bundling with esbuild and not setting `NODE_ENV` shipped the loose half of its own
rules with nothing said anywhere.

`define: { "process.env.NODE_ENV": … }` decides it, because that is a statement and it lets somebody
minifying a development build say so. `minify` decides it next. `NODE_ENV` answers when the build
says neither.
