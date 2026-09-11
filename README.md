# acp-headroom-pi

A pure fusion extension for the [Pi coding agent](https://github.com/earendil-works): it combines two upstream context-management projects and adds nothing else.

- **[billion-context-pi](https://github.com/ranxianglei/billion-context-pi)** — model-driven context management: ref tags, token accounting, nudges, model-written summaries, multi-tier distillation (T1→T2→T3), emergency truncation. Used **unmodified** via its published `createAcpExtension` factory.
- **[headroom](https://github.com/headroomlabs-ai/headroom)** — mechanical, deterministic payload compression through its local proxy, driven by the official `headroom-ai` TypeScript SDK. Tool outputs that would flood the context are compressed before hitting the wire; the model can pull originals back with `headroom_retrieve({ hash })`.

## Architecture

```
session_start ──► load ~/.pi/acp.json "headroom" key
                   probe/spawn local headroom proxy (background)

before_agent_start ──► (ccr mode) append HEADROOM prompt guidance
        ▲ chained: billion-context-pi's handler runs first

before_provider_request ──► headroom stage:
        ▲ chained: ACP has finished all its work    project payload (fail open
                                                    on structured content)
                                                    POST /v1/compress
                                                    { mode, frozen_message_count }
                                                    ──► rewritten payload
```

The ordering **is** the design: headroom hooks `before_provider_request`, the last event before bytes hit the wire. By then billion-context-pi has completed its prune/ref/summary pass, so headroom only ever optimizes final payloads. No upstream patching, no duplicated state, and each side upgrades independently — bumping `billion-context-pi` or `headroom-ai` in `package.json` is the whole upgrade story.

Both upstream packages are declared **external** in the bundle: the shipped extension loads them from `node_modules` at runtime, where a single idempotent postinstall patch (`scripts/patch-upstream.mjs`) applies the one fix upstream has not absorbed yet (the negative-growth nudge deadlock; see `NUDGE-COUNT-GATE-FIX.md`).

## Install

```sh
npm install acp-headroom-pi
```

The headroom half needs the local proxy:

```sh
uv tool install --python 3.13 "headroom-ai[proxy]"
headroom proxy --port 8787        # or let the extension auto-start it
```

## Configuration

One config file: `~/.pi/acp.json` (or `<project>/.pi/acp.json`, which overrides global keys). This plugin claims the `"headroom"`, `"actionFusion"` and `"observationPack"` keys; every other key (including billion-context-pi's) belongs to the upstream extension and is read by it directly.

```jsonc
{
  // billion-context-pi's own keys live here, untouched, e.g.:
  // "delegate": { "enabled": false }
  "headroom": {
    "enabled": true,                 // false bypasses the mechanical stage entirely
    "proxyUrl": "http://127.0.0.1:8787",
    "mode": "ccr",                   // "ccr" | "lossy_inline" | "lossless_then_lossy"
    "minMessages": 4,                // skip tiny conversations
    "minPayloadChars": 4000,
    "frozenMessageCount": 2,         // pin prefix for provider prompt-cache hits
    "timeoutMs": 3000,
    "autoStart": true                // spawn the proxy if it is not reachable
  },
  "actionFusion": true,              // on by default; false keeps pi's stock edit/write
  "observationPack": true            // on by default; see Observation Pack below
}
```

To disable billion-context-pi's delegate-agent feature, set the corresponding upstream key (see its README) — no fork needed. That is the point of this project: behavior changes are configuration, not code.

`HEADROOM_PROXY_URL` (env) overrides `proxyUrl`. `ACP_HEADROOM_LOG` moves the log file (default `~/.pi/acp-headroom.log`, rotated at 10 MB); `ACP_DEBUG=1` enables debug events.

## Action Fusion

Borrowed from [NVLabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) (MIT). Base rollouts repeatedly show the same two turns: edit a file, then run a build/test/run command against it. **On by default**, the built-in `edit` and `write` tools are replaced by versions that accept an optional `then_run: { command, timeout? }` parameter:

```
edit({ path, oldText, newText, then_run: { command: "npm test" } })
```

The mutation and the command run in one tool call and return as a single combined observation — the model decision between the two turns disappears (one model round-trip saved per edit+validate pair, which also removes one message pair from context). Semantics:

- Mutation fails → the command is **skipped** and the error carries a `[then_run:skipped]` marker.
- Command exits non-zero → the error carries `[then_run:failed]` plus the mutation output; the edit/write is **kept**.
- Before the command runs, the target file is re-hashed: if anything changed it in between, the command is skipped rather than validating the wrong content.
- Fused operations on the same canonical file path are serialized (a per-path queue), so two fused mutations of one file cannot interleave.
- `timeout` is in seconds, optional, no default — pass one for commands that may hang.

Default is `true` (an absent key keeps Action Fusion enabled); set `"actionFusion": false` to restore pi's stock tools. Config resolves at global or project scope; an explicit project `false` overrides a global `true`.

## Observation Pack

Borrowed from [NVLabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) (MIT). Very large tool results replayed on every provider request are the most expensive context there is — and past ~16K tokens even a 90% mechanical compression leaves thousands of lossy tokens. Observation Pack owns that size class instead:

**Layering with headroom** (the size split, by threshold):

| Tool result size | Owner | What the model sees |
|---|---|---|
| ≥ 64KB (`OBSERVATION_THRESHOLD_BYTES`) | **Observation Pack** | full text for its first 2 provider requests (headroom still compresses those wire copies for immediate value), then a ~1KB placeholder with head/tail excerpts + metadata |
| 4KB – 64KB | **headroom** | mechanical compression via the local proxy (unchanged behavior) |
| < 4KB | — | untouched |

**How it works** (on by default; `"observationPack": false` disables):

1. A pure-text, non-error tool result ≥ 64KB is content-addressed (`obs_<24hex>` from tool + call id + content hash) and archived under `~/.pi/acp-headroom/observations/<session-id>/objects/` (0600, symlink-refusing, existing objects verified byte-for-byte).
2. For its first 2 provider requests the full text still ships (so the model can work with a fresh result immediately); headroom may lossy-compress those wire copies. Send-counting is stateless — a message has participated in exactly as many requests as there are assistant messages after it, so counts survive restarts.
3. From the 3rd request on, the message is replaced with a stable placeholder: observation id, tool name, original size/lines, head and tail excerpts, and recall instructions.
4. The model pulls exact pages with `obs_recall({ id, offset })` — byte-exact chunks capped at ~3KB / 60 lines, continuing via `next_offset` until `eof`.

**Why the two stages never conflict**: Observation Pack projects at pi's `context` event (chained after billion-context-pi, never touching stored history), headroom at `before_provider_request`. Once packed, a message is ~1KB — below headroom's per-message threshold, so headroom never sees the original again. Conversely, recall chunks are capped below headroom's threshold, so **an exact recall is never mechanically re-compressed**. Everything fails open: a storage failure keeps the full text in context; the session log is never modified, so recall keeps working after compaction or resume.

Archives are per-session and not auto-deleted; the JSONL `ledger.jsonl` next to the objects records every pack/recall event for post-hoc inspection.

## Status line

In TUI sessions the extension adds one entry to pi's status bar (via `ui.setStatus`), updated live from the stage's internal stats:

```
headroom ready              # proxy up, nothing compressed yet this session
headroom ↓12.3k tok · 3     # 3 payloads compressed, 12.3k tokens saved
headroom off                # proxy unreachable — compression bypassed
```

In print/json/rpc modes no status is rendered.

## Failure model

The headroom stage is strictly optional and fails open everywhere:

- Proxy unreachable → payload is sent as-is (hysteretic health cache avoids re-probing every call).
- Payload contains structured content blocks (tool calls, images, thinking) → skipped whole; only plain-string payloads that round-trip exactly are compressed.
- Proxy answers with no gain (`tokens_after >= tokens_before`) → original payload wins.

A missing proxy never blocks or breaks an LLM request; the ACP layer is unaffected by any of it.

## Development

```sh
npm install        # also runs the idempotent upstream patch
npm test           # unit tests (node:test via tsx)
npm run typecheck  # tsc --noEmit
npm run build      # tsup bundle + declarations
npm run upstream   # bump both upstream deps to latest
```

## License

MIT
