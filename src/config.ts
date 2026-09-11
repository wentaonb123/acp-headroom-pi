import { homedir } from "node:os";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

/** User-facing headroom settings, read from the `headroom` key of acp.json.
 *  Every other key in that file belongs to billion-context-pi — this plugin
 *  claims the `headroom` and `actionFusion` namespaces, so the config
 *  surfaces never collide (upstream filters unknown keys out). */
export interface HeadroomSettings {
  /** Set false to bypass the headroom stage entirely (ACP is unaffected). */
  enabled?: boolean;
  /** Base URL of the local headroom proxy. Env HEADROOM_PROXY_URL wins. */
  proxyUrl?: string;
  /** Pipeline mode passed to /v1/compress:
   *  "ccr" (default) — CCR markers + store writes; pairs with the
   *  headroom_retrieve tool.
   *  "lossy_inline" — marker-free, no retrieval round-trip.
   *  "lossless_then_lossy" — alias of lossy_inline. */
  mode?: "ccr" | "lossy_inline" | "lossless_then_lossy";
  /** Skip compression below this many messages (nothing worth optimizing). */
  minMessages?: number;
  /** Skip compression below this many characters of message text. */
  minPayloadChars?: number;
  /** Pin the first N messages byte-for-byte so the provider's prompt-cache
   *  prefix is not rewritten. Omit to let the proxy decide. */
  frozenMessageCount?: number;
  /** Per-request timeout. On timeout the original payload is sent as-is. */
  timeoutMs?: number;
  /** Spawn the proxy when it is not reachable. Default: true. */
  autoStart?: boolean;
}

export interface ResolvedHeadroom {
  enabled: boolean;
  proxyUrl: string;
  mode: "ccr" | "lossy_inline" | "lossless_then_lossy";
  minMessages: number;
  minPayloadChars: number;
  frozenMessageCount: number | undefined;
  timeoutMs: number;
  autoStart: boolean;
}

export const HEADROOM_DEFAULTS: ResolvedHeadroom = {
  enabled: true,
  proxyUrl: "http://127.0.0.1:8787",
  mode: "ccr",
  minMessages: 4,
  minPayloadChars: 4000,
  frozenMessageCount: undefined,
  timeoutMs: 3000,
  autoStart: true,
};

const MODES = new Set(["ccr", "lossy_inline", "lossless_then_lossy"]);

export function resolveHeadroom(raw: unknown): ResolvedHeadroom {
  const s = (raw === false ? { enabled: false } : isObject(raw) ? raw : {}) as HeadroomSettings;
  const proxyUrl =
    process.env.HEADROOM_PROXY_URL?.trim() || s.proxyUrl || HEADROOM_DEFAULTS.proxyUrl;
  return {
    enabled: s.enabled !== false,
    proxyUrl: proxyUrl.replace(/\/+$/, ""),
    mode: s.mode && MODES.has(s.mode) ? s.mode : HEADROOM_DEFAULTS.mode,
    minMessages: positiveInt(s.minMessages, HEADROOM_DEFAULTS.minMessages),
    minPayloadChars: positiveInt(s.minPayloadChars, HEADROOM_DEFAULTS.minPayloadChars),
    frozenMessageCount: nonNegativeInt(s.frozenMessageCount),
    timeoutMs: positiveInt(s.timeoutMs, HEADROOM_DEFAULTS.timeoutMs),
    autoStart: s.autoStart !== false,
  };
}

/** Read only the `headroom` key from acp.json. Project config overrides
 *  global. Never throws — a missing or broken file falls back to defaults. */
export async function loadHeadroomSettings(cwd: string): Promise<ResolvedHeadroom> {
  let merged: unknown;
  for (const base of [path.join(homedir(), CONFIG_DIR_NAME), path.join(cwd, CONFIG_DIR_NAME)]) {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(path.join(base, "acp.json"), "utf8"));
      if (isObject(parsed) && "headroom" in parsed) merged = parsed.headroom;
    } catch {
      // missing file or bad JSON: keep whatever we already have
    }
  }
  return resolveHeadroom(merged);
}

/** Action Fusion (acp.json `actionFusion` key). Borrowed from NVLabs/SoL-Pi
 *  (MIT): replaces pi's built-in edit/write tools with versions that accept
 *  an optional `then_run` follow-up command, saving one model round-trip per
 *  edit+validate pair. On by default — set false to keep pi's stock tools. */
export type ActionFusionSettings = boolean;

/** Read only the `actionFusion` key from acp.json. Project config overrides
 *  global; an explicit project `false` overrides a global `true`. Default:
 *  true (an absent key keeps Action Fusion enabled). Never throws. */
export async function loadActionFusionEnabled(cwd: string): Promise<boolean> {
  let enabled = true;
  for (const base of [path.join(homedir(), CONFIG_DIR_NAME), path.join(cwd, CONFIG_DIR_NAME)]) {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(path.join(base, "acp.json"), "utf8"));
      if (isObject(parsed) && typeof parsed.actionFusion === "boolean") {
        enabled = parsed.actionFusion;
      }
    } catch {
      // missing file or bad JSON: keep whatever we already have
    }
  }
  return enabled;
}

/** ObservationPack (acp.json `observationPack` key). Borrowed from
 *  NVLabs/SoL-Pi (MIT): tool results >= 64KB become stable handles with exact
 *  paged recall (obs_recall) after their first two provider requests. On by
 *  default — set false to keep sending oversized results in full. */
export type ObservationPackSettings = boolean;

/** Read only the `observationPack` key from acp.json. Same resolution as
 *  actionFusion: project overrides global, default true. Never throws. */
export async function loadObservationPackEnabled(cwd: string): Promise<boolean> {
  let enabled = true;
  for (const base of [path.join(homedir(), CONFIG_DIR_NAME), path.join(cwd, CONFIG_DIR_NAME)]) {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(path.join(base, "acp.json"), "utf8"));
      if (isObject(parsed) && typeof parsed.observationPack === "boolean") {
        enabled = parsed.observationPack;
      }
    } catch {
      // missing file or bad JSON: keep whatever we already have
    }
  }
  return enabled;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function positiveInt(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function nonNegativeInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}
