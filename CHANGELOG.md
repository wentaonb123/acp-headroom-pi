# Changelog

## 0.1.3

### Fixed

- **Terminal compress failures no longer trigger forced retry prompts.**
  Gate rejections that can never succeed on retry ("already compressed /
  nothing to do", "too small", "protected zone") and no-op panels are still
  counted toward the per-turn retry cap (the issue #6 emergency loop breaker
  is unaffected), but they no longer force-inject up to 3 "call again NOW"
  prompts per turn. Observed in production: structurally doomed ranges
  produced 3x-per-turn injection loops that repeated every turn.
  Transient argument errors (typebox validation, JSON-encoded content) keep
  the corrective retry prompt — corrected arguments CAN succeed.
- **Nudge recommendations are filtered for staleness at inject time.**
  `filterActionableRanges` (src/index.ts) drops recommended ranges whose
  refs no longer resolve in `messageRefs` (pruned/renumbered since the
  kernel snapshot → atomic batch rejection) or whose end ref has slid into
  the protected tail by action time. Previously every recommended range
  could fail terminally turn after turn while the stale recommendation
  persisted.

### Housekeeping

- tests/integration.test.ts: removed dead imports of the never-committed
  `src/update.js` (auto-update scaffolding) and its two ISSUE-8 tests —
  the module has never existed in the repo or in the published package,
  so the whole file failed to load since it was introduced.

## 0.1.2

- Per-origin health state, proxy spawn dedup/tree-kill, session-scoped
  count model, conditional lock release, clone-on-prune.
