import { Type } from "typebox";
import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ResolvedHeadroom } from "./config.js";
import { log } from "./log.js";

/** Lets the model pull back a mechanically compressed tool output. Only
 *  registered when mode is "ccr" — the other pipeline modes emit no markers,
 *  so a retrieve tool would be a dead end. */

/** Markers carry 24-hex (store default SHA-256[:24]) or 12-hex
 *  (SmartCrusher's Rust row-drop path, mirrored as the store key). */
const HASH_RE = /^[a-f0-9]{12,24}$/i;

const RetrieveParams = Type.Object({
  hash: Type.String({
    description:
      'The hash from a headroom compression marker (e.g. "[headroom hash=...]" or "Retrieve more: hash=...").',
  }),
});

export function makeRetrieveTool(
  getConfig: () => ResolvedHeadroom,
): ToolDefinition<typeof RetrieveParams> {
  return {
    name: "headroom_retrieve",
    label: "Headroom Retrieve",
    description:
      "Retrieve the original content of a mechanically compressed tool output by its hash. Use when a compressed result is marked with a headroom hash and the current step needs the missing detail.",
    promptSnippet: "headroom_retrieve({ hash })",
    promptGuidelines: [
      "Only call it for hashes that appear in a headroom compression marker in context.",
      "Retrieved originals re-enter context at full size — fetch only what the current step needs.",
    ],
    parameters: RetrieveParams,
    async execute(
      _toolCallId,
      params,
      _signal,
      _onUpdate,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<unknown>> {
      const { hash } = params as { hash: string };
      const cfg = getConfig();
      const text = await retrieve(cfg, hash);
      return {
        details: undefined,
        content: [
          {
            type: "text",
            text: text ?? `No stored original found for hash ${hash}.`,
          },
        ],
      };
    },
  };
}

async function retrieve(cfg: ResolvedHeadroom, hash: string): Promise<string | null> {
  if (!HASH_RE.test(hash)) return null;
  const url = new URL(`/v1/retrieve/${hash}`, cfg.proxyUrl);
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) {
      await resp.body?.cancel().catch(() => {});
      return null;
    }
    const data: unknown = await resp.json();
    if (typeof data === "string") return data;
    if (typeof data === "object" && data !== null) {
      const obj = data as { original_content?: unknown; content?: unknown };
      if (typeof obj.original_content === "string") return obj.original_content;
      if (typeof obj.content === "string") return obj.content;
    }
    // Unknown shape: metadata JSON must never leak into model context.
    log.warn({ event: "retrieve-unexpected-shape", sample: JSON.stringify(data).slice(0, 200) });
    return null;
  } catch (e) {
    log.warn({ event: "retrieve-failed", hash, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
