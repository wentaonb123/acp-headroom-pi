import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createAcpExtension } from "billion-context-pi";
import {
  HEADROOM_DEFAULTS,
  loadHeadroomSettings,
  type ResolvedHeadroom,
} from "./config.js";
import { invalidateHealth, proxyHealthy, startProxy, stopSpawnedProxies } from "./proxy.js";
import { HeadroomStage } from "./stage.js";
import { makeRetrieveTool } from "./retrieve-tool.js";
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

export function createFusionExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    let cfg: ResolvedHeadroom = HEADROOM_DEFAULTS;
    const stage = new HeadroomStage(() => cfg);

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
    pi.on("before_provider_request", async (event) => {
      if (!cfg.enabled) return;
      return await stage.compress(event.payload);
    });

    pi.on("session_shutdown", () => {
      // Reclaim only proxies this process spawned — a user-launched instance
      // was never registered and is never touched.
      stopSpawnedProxies();
    });
  };
}

export default createFusionExtension();
