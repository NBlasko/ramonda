---
"@ramonda/check": minor
---

Two rules read what an attribute SAYS rather than that it is there

The last two rules on the audit list, and both gaps were the same shape: an attribute's PRESENCE
read as its meaning, where the source says the opposite out loud.

**`<video muted={false}>` has sound.** The rule went quiet on `muted` being written at all — right
for `muted`, and right for `muted={quiet}`, since anything unreadable has to stay quiet as the
direction that cannot report working markup. It was wrong for the one spelling that settles the
question the other way, and that video's content exists only as sound with nothing to read instead.

**`placeholder=""` names nothing, and reading its presence as a name put the report on the WRONG
RULE.** `named-only-by-a-placeholder` told the author their placeholder is the only name this
control has — on a control with no name at all — while `control-with-no-label`, whose sentence that
is, stayed quiet because a placeholder was written. The report moves to the second rule, which is
not a silence but a correction: the fault was always there and the wrong rule was describing it. A
placeholder this cannot READ still counts as a name, because `placeholder={t("email")}` is somebody
putting words there and only an empty literal is the source saying otherwise.
