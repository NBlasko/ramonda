---
"@ramonda/css": patch
---

**A long run of digits, or a condition that never closes, no longer stalls the editor.** A number was
read by a pattern whose two runs of digits shared every digit, in twelve places, and a `(feature:
value)` pair that never closed took 65 seconds at 5,000 spaces. Both are read in linear time now.
