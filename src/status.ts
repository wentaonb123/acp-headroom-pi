import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { HeadroomStage } from "./stage.js";
import type { ResolvedHeadroom } from "./config.js";

/** Status-line integration via pi's `ui.setStatus` extension point.
 *
 *  The footer shows one compact entry that combines proxy health with the
 *  stage's live compression stats:
 *
 *    headroom off      — proxy unreachable, mechanical compression bypassed
 *    headroom ready    — proxy up, nothing compressed yet this session
 *    headroom ↓12.3k tok · 3 — proxy up, 3 payloads compressed, 12.3k tokens saved
 *
 *  Updates ride the events we already handle (session_start probe and
 *  before_provider_request), so there is no polling and no extra state.
 *  In modes without UI (print/json) we simply never attach. */

const STATUS_KEY = "headroom";

export function statusText(stage: HeadroomStage, cfg: ResolvedHeadroom): string | undefined {
  if (!cfg.enabled) return undefined;
  if (stage.lastProxyUp === false) return "headroom off";
  if (stage.stats.applied === 0) return "headroom ready";
  return `headroom ↓${formatTokens(stage.stats.savedTokens)} tok · ${stage.stats.applied}`;
}

/** 1234 → "1.2k"; keeps the status line one line at any session length. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export class HeadroomStatus {
  private ui: ExtensionUIContext | undefined;

  /** Attach to a UI-capable context (TUI/RPC). No-op otherwise. */
  attach(ui: ExtensionUIContext, hasUI: boolean): void {
    this.ui = hasUI ? ui : undefined;
  }

  /** Re-render from current stage + config state. Safe to call anywhere. */
  update(stage: HeadroomStage, cfg: ResolvedHeadroom): void {
    try {
      this.ui?.setStatus(STATUS_KEY, statusText(stage, cfg));
    } catch {
      // status rendering must never break the request path
    }
  }

  detach(): void {
    try {
      this.ui?.setStatus(STATUS_KEY, undefined);
    } catch {
      // already gone
    }
    this.ui = undefined;
  }
}
