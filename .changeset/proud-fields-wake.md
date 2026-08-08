---
"@ramonda/form": minor
---

`Field` — a field in its own component, which until now could not work

```tsx
@Host("label", (self: TextField) => ({ className: self.f.error ? "field field--invalid" : "field" }))
class TextField extends Component<{ of: FieldNode<string>; label: string }> {
  f = this.use(Field<string>, () => ({ of: this.props.of }));

  render() {
    return [<span className="field__label">{this.props.label}</span>, <input {...this.f.bind} />, this.f.error];
  }
}

<TextField of={f.email} label="E-mail" />;
```

**It is a correctness fix before it is anything else.** A component handed a field node and reading
it directly re-rendered NEVER, and said nothing about it: a field node is one cached object for the
life of the form — deliberately, because a fresh one per access means a fresh `bind.onInput` per
access and RMD020 reports that — so the component's props never changed and the diff skipped it. Its
message never appeared, and a write from anywhere else never reached its input. Both measured. So
every styled input, every shared field component and every row of a list needs this hook.

**And it makes an edit surgical.** The subscription is per path, so a keystroke wakes the fields that
changed and no others: its own path, its ancestors — an aggregate moves when a leaf below it does —
and its descendants, for a whole record landing above. Messages wake only the fields whose messages
moved, so a cross-field rule stays correct, because the schema still re-answers the whole form.

Measured over 300 rows through `list()`, one keystroke: **every row rebuilt, 45 ms** before; **one
row** after. The granularity was always in the list engine — one tracker per item — and the form's
single shared counter flattened it.

`Field` answers everything a node's `$` does, so a component written against `FieldApi<T>` has
nothing new to learn. Name the type at the `use` — `Field<string>` — because `FieldNode<T>` is a
conditional type and `T` cannot be recovered from it by inference; the same pin `Query<Todo>` takes.

A form written inline in one component is unchanged: reaching into `form.fields` is asking about the
form, and that subscription still wakes the owner on everything.

Two smaller things fall out of it. `rows` hands back the same row object for a row that has not moved,
instead of rebuilding every one whenever the array's contents change — a fresh object is a changed
`item` prop, which is what re-rendered all three hundred. And its cache compares row ids by content:
`rowIds` returns the array it keeps and tops up in place, so comparing the reference was comparing a
list against itself.
