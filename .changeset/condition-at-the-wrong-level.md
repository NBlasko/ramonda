---
"@ramonda/css": patch
---

**A condition written at the wrong level names the spelling that level takes.** `color: when $(a) red;`
says *`when` chooses a group — for a value, write `$(c) ? a : b`*, and `$(a) ? ( … ) : ( … );` says
*a choice picks a value — for a group, write `when $(c) { … } else { … }`*. Both were refused before,
with a sentence about something else; the editor and the build now say the same one.
