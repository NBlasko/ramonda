import { Component, Host, bootstrap } from "../framework";

declare const which: string;
declare const chosen: string;

const SPECIFIER = "./pages/a.ts";
const KEY = "VITE_API_URL";

/**
 * What a bundler can and cannot split, measured with Vite 7 rather than assumed.
 *
 * A template with a relative head AND a suffix emits a chunk per matching file — two of them, for
 * `` import(`./pages/${w}.js`) ``. Drop either half and nothing is emitted at all.
 */
export const literal = () => import("./pages/a.ts");
export const templated = () => import(`./pages/${which}.ts`);
export const noSuffix = () => import(`./pages/${which}`);
export const notRelative = () => import(`pages/${which}.ts`);
export const byName = () => import(SPECIFIER);
export const told = () => import(/* @vite-ignore */ chosen);

@Host("div")
class Reads extends Component {
  render() {
    return (
      <div>
        {import.meta.env.VITE_API_URL}
        {import.meta.env["VITE_API_URL"]}
        {import.meta.env[KEY]}
        {import.meta.env[chosen]}
        {import.meta.env.RAMONDA_PUBLIC_API}
        {import.meta.env.MODE}
      </div>
    );
  }
}

bootstrap(<Reads />, null);
