---
"@ramonda/css": minor
---

What a refused block SAYS, which is most of what a constrained prop is worth.

**A kind's variables now print under one name.** `css-system/index.ts` emits `ColorVar`,
`LengthVar` and so on, and `VarByKind` refers to them. A union alias expands wherever TypeScript
prints it, so refusing one colour used to read:

    Type 'string' is not assignable to type 'Token<"color", Fixed<"#10b981">> |
    Token<"color", Fixed<"#00b37e">> | Token<…> | Token<…> | undefined'.

and now reads `Type 'string' is not assignable to type 'ColorVar | undefined'`. The difference is
larger for a whole allow-list, where six expanded tokens per property left nothing readable at all.

It is the shape `Keyword<…>` already uses in the property map, reached from the other side:
`Keyword<K>` survives printing because `K` stands naked in its union, while `VarByKind[K]` is an
indexed access TypeScript resolves on sight — so the alias needs a name rather than laziness.

**A block refused for carrying a runtime value now says why.** It read *`false` is not assignable to
type `true`*, which names two types and tells nobody anything. The flag carries the sentence
instead — the shape `CssCondition` and `CssSpreadable` already use — so the diagnostic TypeScript
writes is the explanation, and there is none of ours to add.

Run `ramonda-css codegen` to pick up the new aliases; they are additive, and `Var<"color">` is
unchanged.
