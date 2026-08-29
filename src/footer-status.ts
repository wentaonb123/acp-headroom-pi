import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getDelegateUsage } from "./delegate-tool.js";
import { activeHeadroomSnapshot } from "./headroom/stage.js";
import { proxyHealthy } from "./headroom/client.js";

const FOOTER_STATUS_KEY = "acp-headroom-pi";
let ui: ExtensionContext["ui"] | undefined;
let lastFooterText: string | undefined = "";

/** Mirrors pi's footer.js formatTokens: lowercase k/M, thresholds <1000/<10000/<1e6/<1e7. */
export function formatCompactTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export function initFooterStatus(ctx: ExtensionContext): void {
  ui = ctx.ui;
  lastFooterText = undefined;
}

/** Headroom footer segment: whether the proxy is live this session and the
 *  cumulative tokens saved by live compression. Health comes from the same
 *  cached probe as the request path (client.ts proxyHealthy — 30s positive /
 *  15s negative TTL), so a 500ms tick never hammers the proxy. */
async function headroomStatusText(savedTokens: number, proxyUrl: string, enabled: boolean): Promise<string> {
  if (!enabled) return "headroom off";
  const healthy = await proxyHealthy(proxyUrl);
  if (!healthy) return "headroom \u26a0 pass-through";
  if (savedTokens > 0) return `headroom \u2713 ${formatCompactTokens(savedTokens)} saved`;
  return "headroom \u2713 ready";
}

/** Refresh the footer status line (delegate usage + headroom state). Cheap:
 *  cached reads only; no-ops when the rendered text is unchanged (called on
 *  a 500ms tick). Async only for the headroom health probe, which is itself
 *  cached in client.ts. Concurrent ticks are harmless — lastFooterText
 *  dedupes the ui.setStatus call. */
export async function updateFooterStatus(): Promise<void> {
  if (!ui) return;
  const parts: string[] = [];
  const usage = getDelegateUsage();
  if (usage && usage.totalTokens > 0) {
    const costStr = usage.cost.total > 0 ? ` ($${usage.cost.total.toFixed(4)})` : "";
    parts.push(`sub-agents \u2191${formatCompactTokens(usage.input)} \u2193${formatCompactTokens(usage.output)}${costStr}`);
  }
  const hr = activeHeadroomSnapshot();
  if (hr) parts.push(await headroomStatusText(hr.stats.savedTokens, hr.proxyUrl, hr.enabled));
  const text = parts.length > 0 ? parts.join(" \u00b7 ") : undefined;
  if ((text ?? "") === lastFooterText) return;
  lastFooterText = text ?? "";
  try {
    ui.setStatus(FOOTER_STATUS_KEY, text);
  } catch {
    // session is tearing down — best effort
  }
}

export function disposeFooterStatus(): void {
  if (ui) {
    try {
      ui.setStatus(FOOTER_STATUS_KEY, undefined);
    } catch {
      // best effort
    }
  }
  ui = undefined;
  lastFooterText = "";
}