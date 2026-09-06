# Changelog

## 0.3.0

### Added

- **Status-line integration.** In TUI sessions the extension now adds a
  `headroom` entry to pi's status bar via `ui.setStatus`, combining proxy
  health with the stage's live stats: `headroom ready` (proxy up, nothing
  compressed yet), `headroom ↓12.3k tok · 3` (three payloads compressed,
  12.3k tokens saved), or `headroom off` (proxy unreachable, compression
  bypassed). Updates ride the existing session_start probe and
  before_provider_request events — no polling, no extra state. In
  print/json/rpc modes nothing is rendered. `HeadroomStage` additionally
  exposes `lastProxyUp` for status consumers.

## 0.2.0

### Changed — full rewrite as a pure fusion extension

This release removes all vendored upstream source code. The plugin is now a
thin integration layer around two published packages:

- `billion-context-pi` (model-driven context management) is used unmodified
  via its exported `createAcpExtension` factory.
- `headroom` (mechanical payload compression) is driven through the official
  `headroom-ai` TypeScript SDK against the local proxy's `/v1/compress`.

Integration points (no upstream forks, no vendored copies):

- `before_agent_start` / `before_provider_request` handlers are registered
  after the ACP layer's and rely on pi's chained event semantics, so headroom
  compresses the exact bytes about to hit the wire — after ACP has finished
  its prune/ref/summary work.
- `session_start` loads only the `"headroom"` key of `~/.pi/acp.json`; every
  other key (e.g. disabling delegate-agent) is billion-context-pi's own
  configuration surface and is read by upstream directly.
- `headroom_retrieve({ hash })` tool (ccr mode) pulls compressed originals
  back via the proxy's `/v1/retrieve` endpoint.

Both upstream packages are external in the bundle and load from node_modules
at runtime; `scripts/patch-upstream.mjs` (postinstall) applies a single
idempotent patch — the negative-growth nudge deadlock clamp — which upstream
has not absorbed yet (the old count-gate patch is no longer needed; bcp ships
it natively).

Removed: all vendored src/headroom/* modules, the old test suite covering
them, and T2-DISTILL-FIX.md (fix absorbed upstream).

### Added

- Hysteretic proxy health checking (30s positive cache, retry-once, 15s
  negative cache), background auto-start of the local headroom proxy
  (`headroom` on PATH, then `uv tool run`), and tree-safe reclamation of only
  the processes this plugin spawned.
- Fail-open payload adapter: only plain-string (or all-text-block) payloads
  that round-trip exactly are compressed; structured content skips whole.
- New unit test suite (config resolution, payload projection/round-trip,
  fail-open stage behavior, retrieve tool hash validation).

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
