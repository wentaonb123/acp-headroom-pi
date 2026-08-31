import { type Config, type Prompts } from "acp-kernel";
import type { ThrottleRetryConfig } from "./throttle-retry.js";
import type { HeadroomSettings } from "./headroom/config.js";
export type { HeadroomSettings } from "./headroom/config.js";
/** Delegate sub-agent configuration. */
export interface DelegateConfig {
    /** Enable acp_delegate tools (delegate/wait/cancel) and their system-prompt
     *  section. Default: true. Set `enabled: false` to skip registering them. */
    enabled?: boolean;
    /** How delegate usage is reported back to the main session.
     *  "separate" (default) — delegate tokens tracked in a separate accumulator;
     *  main session totals stay clean, delegate usage shows as its own block in
     *  acp_status (excluded from main totals).
     *  "merged" — delegate token usage folded into the tool-result usage field,
     *  counted as part of the main session totals. */
    displayUsage?: "merged" | "separate";
}
/** Compression tuning fields, shared by all three levels (global, provider,
 *  model). Percentage fields accept a ratio (0.75) or percent string ("75%").
 *  Resolution is per-field, deepest-wins (model > provider > global); an
 *  undefined field at a deeper level does NOT clear a shallower value. */
export interface CompressSettings {
    /** Context usage percentage that triggers forced compression nudges
     *  (bypasses growth-gate + cadence). Accepts a ratio (0.75) or percent
     *  string ("75%"). Default: 0.75. Maps to kernel nudge.maxContextLimitPct. */
    maxContextLimit?: number | string;
    /** Context usage percentage that triggers emergency truncation of large
     *  tool outputs. Accepts a ratio (0.95) or percent string ("95%").
     *  Default: 0.95. Must be >= maxContextLimit. Maps to kernel
     *  nudge.emergencyThresholdPct + truncate.threshold. */
    emergencyThresholdPercent?: number | string;
    /** Token growth threshold for soft compression nudges. Default: 50000.
     *  Maps to kernel nudge.growthFloor + nudge.growthCap. */
    nudgeGrowthTokens?: number;
    /** Number of active tier-1 blocks that triggers tier-2 distillation nudge
     *  (count gate, independent of token-pressure ordering). Default: 5.
     *  Maps to kernel tiers.tier2Trigger. */
    tier2Trigger?: number;
    /** Number of active tier-2 blocks that triggers tier-3 condensation nudge
     *  (count gate). Default: 10. Maps to kernel tiers.tier3Trigger. */
    tier3Trigger?: number;
}
/** Per-provider compression overrides. Carries the same tuning fields as the
 *  global level, plus an optional per-model map keyed by model id. */
export interface ProviderCompress extends CompressSettings {
    /** Per-model overrides within this provider, keyed by model id
     *  (e.g. "claude-sonnet-4-5"). */
    models?: Record<string, CompressSettings>;
}
/** Compression tuning. Top-level fields are global defaults; `providers`
 *  optionally narrows them per Pi provider name and per model id. The active
 *  entry is resolved live each turn from the current model
 *  (`ctx.model.provider` / `ctx.model.id`). */
export interface CompressConfig extends CompressSettings {
    /** Per-provider (and per-model) overrides, keyed by Pi provider name
     *  (e.g. "anthropic", "openai", "zhipu") — the same name used in
     *  models.json and `pi --provider`. */
    providers?: Record<string, ProviderCompress>;
}
/**
 * Adapter configuration. Maps onto acp-kernel's `Config` plus Pi-specific knobs
 * (live model context window, protected tools, state persistence).
 */
export interface AdapterConfig {
    /** When omitted, the adapter reads `ctx.model.contextWindow` live each turn.
     *  Set explicitly for tests/headless runs. */
    modelContextLimit?: number;
    protectedTools?: string[];
    preserveRecentMessages?: number;
    /** Accepted for acp.json compatibility; no longer used (self-update check
     *  was removed in the acp-headroom-pi fork). */
    autoUpdate?: boolean;
    /** Enable debug-level events in the ACP log file (default ~/.pi/acp.log).
     *  Always-on events (session/turn/compress/delegate lifecycle, all errors and
     *  warnings) are written regardless; `debug` only adds verbose diagnostics.
     *  Default: false (or env ACP_DEBUG=1/true). */
    debug?: boolean;
    /** Default timeout in seconds injected into the bash tool when the model
     *  omits `timeout`. Pi has NO built-in default, so without this a command
     *  that the model forgets to time out can hang for thousands of seconds.
     *  Default: 60 (catches hangs quickly). On timeout the model is guided to
     *  re-run with a larger `timeout`. Set to 0 to disable (restore Pi's
     *  unbounded behavior). */
    toolBashDefaultTimeout?: number;
    /** Hard byte cap applied to tool result text via the `tool_result` hook.
     *  Default: 200000 (~200KB, roughly 5000 lines at ~40 bytes/line) — a
     *  generous ceiling that stops runaway output. Pi already caps bash/read/grep
     *  at 50KB/2000 lines (bash full output is saved to a temp file), so this
     *  default mainly caps tools Pi doesn't cap. Set lower (e.g. 8192) for a
     *  tighter context budget, or 0 to disable. When capped, oversized text is
     *  head-truncated with a notice telling the model how to see the full output
     *  (bash: read BashToolDetails.fullOutputPath). */
    toolOutputMaxBytes?: number;
    /** Delegate sub-agent config. Accepts a boolean shorthand (`true` →
     *  `{ enabled: true }`, `false` → `{ enabled: false }`) or a DelegateConfig
     *  object. Default: enabled. */
    delegate?: boolean | DelegateConfig;
    /** Compression tuning. */
    compress?: CompressConfig;
    /** Provider token-throttle (Bedrock "Too many tokens, please wait before
     *  trying again.") auto-retry. Accepts a boolean shorthand (`false`
     *  disables) or a ThrottleRetryConfig object. Default: enabled, 10 retries,
     *  60s exponential base capped at 300s per kick. */
    throttleRetry?: boolean | ThrottleRetryConfig;
    /** Headroom mechanical tool-output compression (local proxy). Accepts a
     *  boolean shorthand (`false` disables) or HeadroomSettings. Default:
     *  enabled, proxy http://127.0.0.1:8787 (env HEADROOM_PROXY_URL wins). */
    headroom?: boolean | HeadroomSettings;
    /** Legacy flat alias for `delegate.displayUsage`. Kept for backward
     *  compatibility with existing acp.json files. Prefer `delegate.displayUsage`. */
    displayUsage?: "merged" | "separate";
    /** Override acp-kernel's load-bearing compression prompt rules (the 4
     *  Prompts fields). Each set field replaces the kernel default verbatim.
     *  Requires acknowledgePromptsRisk: true — without it, overrides are dropped
     *  (defaults used) and a warning is logged. Set via ~/.pi/acp.json. */
    prompts?: Partial<Prompts>;
    /** Must be true for `prompts` overrides to take effect. Acknowledges that
     *  replacing the kernel's tuned compression rules may reduce summary quality
     *  (lost paths/signatures/decisions → worse retrieval). */
    acknowledgePromptsRisk?: boolean;
    coreOverrides?: Partial<Config>;
}
export declare const DEFAULT_TOOL_BASH_TIMEOUT = 60;
export declare const DEFAULT_TOOL_OUTPUT_MAX_BYTES = 200000;
/** Resolve delegate config from the adapter, handling the boolean shorthand
 *  and the legacy flat `displayUsage` alias. */
export declare function resolveDelegate(adapter: AdapterConfig): {
    enabled: boolean;
    displayUsage: "merged" | "separate";
};
/** Per-field deepest-wins merge of the three compression levels (global →
 *  provider → model). An undefined field at a deeper level does NOT clear a
 *  value set at a shallower level — only a defined value overrides. */
export declare function mergeCompress(global?: CompressSettings, provider?: CompressSettings, model?: CompressSettings): CompressSettings;
/** Resolve the effective compression settings for the active model: global →
 *  provider (matched by Pi provider name) → model (matched by model id).
 *  Returns a CompressSettings whose fields are undefined when nothing is set
 *  at any level. The Pi adapter keys providers by name (ctx.model.provider),
 *  not URL — it never sees the upstream URL the way the proxy does. */
export declare function resolveCompress(compress: CompressConfig | undefined, provider: string | undefined, modelId: string | undefined): CompressSettings;
export declare function resolveConfig(adapter: AdapterConfig, liveContextLimit: number, provider?: string, modelId?: string): Config;
/** Parse a ratio (0.75) or percent string ("75%") into a 0-1 ratio. Returns
 *  undefined for anything that is not a finite value in (0, 1] — a warn is
 *  logged so a typo surfaces, and callers keep the kernel default instead of
 *  poisoning nudge/threshold comparisons with NaN (NaN makes every comparison
 *  false: nudges silently never fire). */
export declare function parsePercent(v: number | string, field?: string): number | undefined;
