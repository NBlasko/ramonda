---
"@ramonda/devtools": minor
---

A dev error detonates the badge instead of opening the panel.

Opening was wrong twice over: it interrupts whatever you were doing, and — once the panel docked —
it also reflowed the app, which is how a media query flipped and the layout you were shown stopped
being the one the error happened in. Floating fixed the reflow. This removes the interruption.

The badge now **explodes**: a shake that overshoots both ways, two rings expanding out of it, and a
spray of eight sparks. Then it settles into a red badge with a count and a slow breathing glow,
which stays until you open the panel. The burst says *now*, the breathing says *still* — a permanent
burst would be unbearable in a session with a hundred diagnostics, and no lasting state at all would
mean an error you glanced away from never happened. Each new error detonates again (the animation is
restarted from JS, since re-adding a class replays nothing), the count caps at `99+`, and
`prefers-reduced-motion` gets the colour and the count without the fireworks.

Nothing about the app moves. The framework-initiated open (`ramonda:toggle-devtools` with
`forceOpen`) still floats for the same reason as before.
