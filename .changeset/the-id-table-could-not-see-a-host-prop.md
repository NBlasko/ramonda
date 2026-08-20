---
"@ramonda/check": patch
---

The last of the audit: the id table, `duplicate-id` and `head-tags-collide`.

**The id table could not see an id written in `@Host` props, and reported a working link as broken.**

    @Host("section", () => ({ id: "overview" }))
    class Overview extends Component { … }

    <a href="#overview">…</a>        // reported: "nothing in the project carries id=overview"

That id is on the page and is in no JSX element, so the walk — which reads elements — never found
it. The table reads a `@Host` props object now, under the same rules it reads an element by: a
literal is an id, a template's head is a prefix, and an id it cannot READ silences the family
exactly as an unreadable one on a host element does. The shape became likelier the day `@Host`'s
props became typed as the element's attributes.

**`duplicate-id` counted a COMPONENT's `id`, which is as often a datum as a DOM id.**
`<ProfileCard id={user.id} />` hands it to `getProfile()` and it never reaches the document.
`idTable` had already decided this for the other two rules and decided it the other way round, which
is the point: adding a component's literal id to the set of KNOWN ids can only make a rule quieter,
while counting it as a CLAIM on one can only make this rule louder. The safe direction differs
because the reading does. Nothing is lost — a component's id reaches the document only by being
written onto a host element, and that host element is in the source too.

**Two `Head` hooks are not a collision, and that is now written down with the measurement.** They
merge into the same map, so a `name="robots"` in each collides exactly as two in one list do — the
document keeps one `<meta>` and it carries the LAST value. What differs is the reading: two entries
in one array express nothing by being two, while two hooks express an override, which is how a base
class sets a page's defaults and a subclass replaces one of them.
