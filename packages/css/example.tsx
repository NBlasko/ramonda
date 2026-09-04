/**
 * The example `DESIGN.md` opens with, kept as a file so its numbers are reproducible:
 *
 *     node packages/css/prototype-extract.mjs packages/css/example.tsx
 *
 * Nothing imports this and no tsconfig includes it. The `css` tag is declared here rather than
 * imported because the package it would come from does not exist yet.
 */
declare function css(
  strings: TemplateStringsArray,
  ...values: (string | number)[]
): string & { readonly __cssBlock: true };

declare const isOnline: boolean;

export const Card = (
  <div
    css={css`
    display: flex;
    flex-direction: column;
    padding: 24px;
    background-color: #0f172a;
    border-left: ${isOnline ? "4px solid #10b981" : "4px solid #64748b"};
  `}
  >
    <h3 css={css`margin: 0; color: #ffffff;`}>Nikola</h3>
  </div>
);
