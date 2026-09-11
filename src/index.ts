import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createAcpExtension } from "billion-context-pi";
import type {
  AgentToolResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  HEADROOM_DEFAULTS,
  loadActionFusionEnabled,
  loadHeadroomSettings,
  loadObservationPackEnabled,
  type ResolvedHeadroom,
} from "./config.js";
import { registerActionFusionTools } from "./action-fusion.js";
import {
  RECALL_MAX_BYTES,
  RECALL_MAX_LINES,
  type RecallChunk,
  isObservationId,
  logLedger,
  observationPath,
  observationRoot,
  projectObservations,
  readRecallChunk,
} from "./observation-pack.js";
import { invalidateHealth, proxyHealthy, startProxy, stopSpawnedProxies } from "./proxy.js";
import { HeadroomStage } from "./stage.js";
import { makeRetrieveTool } from "./retrieve-tool.js";
import { HeadroomStatus } from "./status.js";
import { log } from "./log.js";

/** Fusion of two upstream projects:
 *
 *  - billion-context-pi — model-driven context management (ref tags, nudge,
 *    model-written summaries, multi-tier distillation). Used unmodified.
 *  - headroom          — mechanical, deterministic payload compression via its
 *    local proxy, through the official headroom-ai SDK.
 *
 *  This file owns no compression logic. It wires the two together and exposes
 *  configuration. Upgrading either side is a dependency bump. */

const HEADROOM_PROMPT = `
HEADROOM TOOL-OUTPUT COMPRESSION

Older tool results may have been mechanically compressed before entering your context. A compressed output carries a marker with a hash, e.g. "[headroom hash=a1b2c3d4...]", "Retrieve more: hash=..." or "<<ccr:HASH,...>>":
- Treat such content as an OUTLINE: structure, keys, errors and anomalies are preserved; bulk detail is not.
- When you need the missing detail, call headroom_retrieve({ hash }) with that marker's hash.
- Retrieved originals re-enter context at full size — fetch only what the current step needs.
`;

const INSTALL_HINT =
  'Install it with: uv tool install --python 3.13 "headroom-ai[proxy]"';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function createFusionExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    let cfg: ResolvedHeadroom = HEADROOM_DEFAULTS;
    let actionFusionOn = false;
    let observationPackOn = false;
    let sessionRoot = observationRoot("default");
    const stage = new HeadroomStage(() => cfg);
    const status = new HeadroomStatus();

    // 1. Upstream ACP layer, registered first so our handlers see its output
    //    (both `before_agent_start` and `before_provider_request` are chained:
    //    each handler receives the previous one's result).
    createAcpExtension({})(pi);

    pi.on("session_start", async (_event, ctx) => {
      stage.resetSession();
      invalidateHealth();
      try {
        cfg = await loadHeadroomSettings(ctx.cwd);
      } catch (e) {
        log.warn({ event: "config-load-failed", error: e instanceof Error ? e.message : String(e) });
        cfg = HEADROOM_DEFAULTS;
      }
      status.attach(ctx.ui, ctx.hasUI);
      status.update(stage, cfg);

      // Action Fusion (on by default): replace edit/write with fused versions
      // that accept a then_run follow-up command. Registered in session_start
      // so the config file decides per project; pi 0.83 has no trust gate, so
      // a project-local acp.json disables it the same way it enables headroom.
      try {
        actionFusionOn = await loadActionFusionEnabled(ctx.cwd);
      } catch (e) {
        log.warn({ event: "action-fusion-config-failed", error: e instanceof Error ? e.message : String(e) });
        actionFusionOn = false;
      }
      if (actionFusionOn) registerActionFusionTools(pi);

      // ObservationPack (on by default): oversized tool results become stable
      // handles with exact paged recall via obs_recall, after their first two
      // provider requests. Layers with headroom: >= 64KB -> pack (placeholder
      // is ~1KB, below headroom's per-message threshold), below -> headroom.
      try {
        observationPackOn = await loadObservationPackEnabled(ctx.cwd);
      } catch (e) {
        log.warn({ event: "observation-pack-config-failed", error: e instanceof Error ? e.message : String(e) });
        observationPackOn = false;
      }
      if (observationPackOn) {
        sessionRoot = observationRoot(ctx.sessionManager.getSessionId());
        pi.registerTool(makeObsRecallTool(() => sessionRoot));
      }

      if (!cfg.enabled) return;

      log.info({ event: "session-start", proxyUrl: cfg.proxyUrl, mode: cfg.mode });

      if (cfg.mode === "ccr") {
        pi.registerTool(makeRetrieveTool(() => cfg));
      }

      // Background availability probe, outside the request path so a missing
      // binary never delays the first LLM call.
      void (async () => {
        try {
          if (cfg.autoStart) stage.markProxyAttempted();
          const ok =
            (await proxyHealthy(cfg.proxyUrl, cfg.timeoutMs)) ||
            (cfg.autoStart && (await startProxy(cfg.proxyUrl, cfg.timeoutMs)));
          stage.lastProxyUp = ok;
          status.update(stage, cfg);
          if (!ok && ctx.hasUI) {
            ctx.ui.notify(
              `[ACP] Headroom proxy not found at ${cfg.proxyUrl} — mechanical compression is bypassed (ACP summaries unaffected). ${INSTALL_HINT}`,
            );
          }
        } catch (e) {
          log.warn({ event: "probe-failed", error: e instanceof Error ? e.message : String(e) });
        }
      })();
    });

    pi.on("before_agent_start", (event) => {
      if (!cfg.enabled || cfg.mode !== "ccr") return;
      return { systemPrompt: `${event.systemPrompt ?? ""}\n${HEADROOM_PROMPT}` };
    });

    // 2. Headroom layer: optimize the exact bytes about to go on the wire.
    pi.on("before_provider_request", async (event, ctx) => {
      if (!cfg.enabled) return;
      const out = await stage.compress(event.payload);
      // Live status: reflect fresh stats + proxy health after every request.
      status.update(stage, cfg);
      return out;
    });

    // 3. ObservationPack projection (context event): runs chained AFTER the
    //    upstream ACP handler (registered first), so it sees the ref-tagged
    //    message array and replaces oversized tool results with placeholders.
    //    Headroom then runs later at the wire layer and only ever sees the
    //    ~1KB placeholders for packed messages — the two stages cannot claim
    //    the same content in the same request.
    pi.on("context", async (event) => {
      if (!observationPackOn) return;
      const projected = await projectObservations(event.messages, sessionRoot);
      if (projected) return { messages: projected };
    });

    pi.on("session_shutdown", () => {
      status.detach();
      // Reclaim only proxies this process spawned — a user-launched instance
      // was never registered and is never touched.
      stopSpawnedProxies();
    });
  };
}

export default createFusionExtension();

/** The obs_recall tool: exact paged reads from the per-session observation
 *  archive. Chunk limits stay below headroom's per-message threshold, so a
 *  recall result is never mechanically re-compressed. */
function makeObsRecallTool(getRoot: () => string): ToolDefinition<typeof ObsRecallParams> {
  return {
    name: "obs_recall",
    label: "Recall Observation",
    description:
      "Read a stored large tool result by observation id and byte offset. Exact, uncompressed pages (~3KB) from the ObservationPack archive; continue with the returned next_offset.",
    promptSnippet: 'obs_recall({ id: "obs_...", offset: 0 })',
    promptGuidelines: [
      "Call when a placeholder references an observation id and you need the archived detail.",
      "Use next_offset from the response to page further; stop at eof: true.",
    ],
    parameters: ObsRecallParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
      const { id, offset } = params as Static<typeof ObsRecallParams>;
      if (!isObservationId(id)) throw new Error(`Unknown observation id: ${id}`);
      let chunk: RecallChunk;
      try {
        chunk = await readRecallChunk(observationPath(getRoot(), id), offset ?? 0, {
          maxBytes: RECALL_MAX_BYTES - 512,
          maxLines: RECALL_MAX_LINES - 2,
        });
      } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") {
          throw new Error(`Unknown observation id: ${id}`);
        }
        throw error;
      }
      const header = [
        `[obs_recall id=${id} offset=${offset ?? 0} next_offset=${chunk.nextOffset} eof=${chunk.eof}]`,
        `[chunk_bytes=${chunk.bytes} chunk_lines=${chunk.lines}; use next_offset to continue]`,
      ].join("\n");
      void logLedger(getRoot(), {
        event: "recall",
        id,
        offset: offset ?? 0,
        bytes: chunk.bytes,
        lines: chunk.lines,
        eof: chunk.eof,
      }).catch(() => {});
      return {
        details: undefined,
        content: [{ type: "text", text: `${header}\n${chunk.text}` }],
      };
    },
  };
}

const ObsRecallParams = Type.Object({
  id: Type.String({ description: "Observation id from a placeholder (obs_...)" }),
  offset: Type.Optional(Type.Integer({ minimum: 0, description: "Byte offset, default 0" })),
});
