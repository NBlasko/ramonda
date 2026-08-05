// Replaced by esbuild's `--define` per build: true for `dev`, false for `build`. The devtools
// import is behind it, so a production bundle never carries the panel.
//
// This is the only global the project needs. The JSX factory used to be declared here too; it is
// not any more, because the compiler imports Ramonda's automatic runtime per file.
declare const __DEV__: boolean;
