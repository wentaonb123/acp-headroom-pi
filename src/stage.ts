import { HeadroomClient } from "headroom-ai";
import type { ResolvedHeadroom } from "./config.js";
import { projectPayload, payloadChars, type OpenAIMessage } from "./format.js";
import { invalidateHealth, proxyHealthy, startProxy } from "./proxy.js";
import { log } from "./log.js";

/** The headroom half of the fusion: mechanical compression of the provider
 *  payload, applied in pi's `before_provider_request` event.
 *
 *  Placement is the whole design. billion-context-pi has already finished its
 *  work by then (prune, ref tags, model-written summaries), so headroom sees
 *  the exact bytes about to go on the wire and only has to optimize them —
 *  no patching of the upstream extension, no duplicated state, and the two
 *  layers can be upgraded independently. */

export interface HeadroomStats {
  /** Payloads the proxy actually shrank. */
  applied: number;
  savedTokens: number;
  /** Times we sent the payload untouched (proxy down, tiny payload, ...). */
  skipped: number;
}

interface CompressResponse {
  messages?: Array<{ role?: string; content?: unknown }>;
  tokens_before?: number;
  tokens_after?: number;
  ccr_hashes?: unknown;
}

export class HeadroomStage {
  stats: HeadroomStats = { applied: 0, savedTokens: 0, skipped: 0 };
  /** Last known proxy reachability, for the status line: undefined = not yet
   *  probed, true = last request-path check passed, false = down. */
  lastProxyUp: boolean | undefined = undefined;
  /** Consecutive rounds with an unreachable proxy — the UI notice fires only
   *  on a confirmed outage, not a single stalled probe. */
  private downRounds = 0;
  private notifiedUnavailable = false;
  private proxyTried = false;

  constructor(private readonly getConfig: () => ResolvedHeadroom) {}

  resetSession(): void {
    this.stats = { applied: 0, savedTokens: 0, skipped: 0 };
    this.lastProxyUp = undefined;
    this.downRounds = 0;
    this.notifiedUnavailable = false;
    this.proxyTried = false;
  }

  /** Called by session_start after its own spawn attempt so the request path
   *  never blocks on startup polling — it only fast health-checks afterwards. */
  markProxyAttempted(): void {
    this.proxyTried = true;
  }

  get unavailableStreak(): number {
    return this.downRounds;
  }

  /** Compress a provider payload. Returns the original on any failure — the
   *  request must always go through, compressed or not. */
  async compress(payload: unknown): Promise<unknown> {
    const cfg = this.getConfig();
    if (!cfg.enabled) return payload;
    try {
      return await this.compressInner(payload, cfg);
    } catch (e) {
      log.warn({ event: "stage-error", error: e instanceof Error ? e.message : String(e) });
      return payload;
    }
  }

  private async compressInner(payload: unknown, cfg: ResolvedHeadroom): Promise<unknown> {
    if (!(await proxyHealthy(cfg.proxyUrl, cfg.timeoutMs))) {
      if (cfg.autoStart && !this.proxyTried) {
        this.proxyTried = true;
        if (!(await startProxy(cfg.proxyUrl, cfg.timeoutMs))) return this.noteDown(payload, cfg);
      } else {
        return this.noteDown(payload, cfg);
      }
    }
    this.downRounds = 0;
    this.lastProxyUp = true;

    const view = projectPayload(payload);
    if (!view) return this.skip(payload);
    if (view.messages.length < cfg.minMessages) return this.skip(payload);
    if (payloadChars(view.messages) < cfg.minPayloadChars) return this.skip(payload);

    const model = modelOf(payload);
    const body: Record<string, unknown> = {
      model,
      messages: view.messages,
      config: {
        mode: cfg.mode,
        ...(cfg.frozenMessageCount !== undefined
          ? { frozen_message_count: cfg.frozenMessageCount }
          : {}),
      },
    };

    let data: CompressResponse;
    try {
      const client = new HeadroomClient({
        baseUrl: cfg.proxyUrl,
        timeout: cfg.timeoutMs,
        retries: 0,
        fallback: false,
      });
      data = (await client.compressRaw(body)) as CompressResponse;
    } catch (e) {
      log.warn({ event: "compress-failed", error: e instanceof Error ? e.message : String(e) });
      invalidateHealth(cfg.proxyUrl);
      this.lastProxyUp = false;
      return this.skip(payload);
    }

    const compressed = toMessages(data.messages);
    if (!compressed) return this.skip(payload);

    const before = num(data.tokens_before);
    const after = num(data.tokens_after);
    if (before > 0 && after > 0 && after >= before) {
      log.debug({ event: "no-gain", before, after });
      return this.skip(payload);
    }

    this.stats.applied += 1;
    this.stats.savedTokens += Math.max(0, before - after);
    log.info({ event: "applied", before, after, saved: Math.max(0, before - after) });
    return view.apply(compressed);
  }

  private skip(payload: unknown): unknown {
    this.stats.skipped += 1;
    return payload;
  }

  private noteDown(payload: unknown, cfg: ResolvedHeadroom): unknown {
    this.downRounds += 1;
    this.lastProxyUp = false;
    this.stats.skipped += 1;
    if (!this.notifiedUnavailable) {
      this.notifiedUnavailable = true;
      log.warn({
        event: "proxy-unavailable",
        proxyUrl: cfg.proxyUrl,
        effect: "pass-through-uncompressed",
      });
    }
    return payload;
  }
}

function modelOf(payload: unknown): string {
  if (typeof payload === "object" && payload !== null) {
    const m = (payload as Record<string, unknown>).model;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return "default";
}

function toMessages(raw: CompressResponse["messages"]): OpenAIMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: OpenAIMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m.role !== "string") return null;
    out.push({ role: m.role, content: typeof m.content === "string" ? m.content : textOf(m.content) });
  }
  return out;
}

/** The proxy returns OpenAI content, which may be a string or text blocks.
 *  Anything else cannot be written back safely. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") parts.push(block);
      else if (
        typeof block === "object" &&
        block !== null &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        parts.push((block as { text: string }).text);
      } else {
        return "";
      }
    }
    return parts.join("\n");
  }
  return "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
