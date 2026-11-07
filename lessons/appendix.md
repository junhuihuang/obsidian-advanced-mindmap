# Appendix — unverified notes

Evidence here is weak. Verify before relying on it, and promote the rule into a topic
file (with the measurement) if it holds.

## Multi-app / resizable-host scenarios

Behaviour can diverge when the host window runs in a multi-window or
`Split View` / `Slide Over`-style layout. Two mistakes from earlier rounds: skipping those
scenarios entirely because no device was available, and not re-running layout/cache
invalidation when the window size changes.

This note may originate from a different (mobile) project — this plugin runs in Obsidian's
desktop/Electron window. Do not build on it without reproducing it first.
