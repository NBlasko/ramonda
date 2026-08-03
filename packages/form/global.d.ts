// `h` and the JSX namespace are declared globally by @ramonda/core's global.ts
// (pulled in via the import graph). Only the build-time flags need declaring here.
declare global {
  const __DEV__: boolean;
  const __TEST__: boolean;
}

export {};
