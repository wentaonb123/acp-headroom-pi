import { Type, type Static } from "typebox";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AdapterConfig } from "../config.js";
import { resolveHeadroom } from "./config.js";
import { isValidHash, retrieveOriginal } from "./client.js";

const RetrieveParams = Type.Object({
	hash: Type.String({ description: "The 24-character hex hash from a [headroom] compression marker (hash=...)." }),
});

type RetrieveArgs = Static<typeof RetrieveParams>;

export function makeRetrieveTool(getAdapter: () => AdapterConfig): ToolDefinition<typeof RetrieveParams> {
	return {
		name: "headroom_retrieve",
		label: "Headroom Retrieve",
		description:
			"Retrieve the original, uncompressed content behind a Headroom compression marker. " +
			"Pass the hash shown in the marker. Use when the compressed view is missing detail you need.",
		promptSnippet: 'headroom_retrieve({ hash: "<24-hex hash>" })',
		promptGuidelines: [
			"Call when a compressed tool output references a hash and you need the full original text.",
			"Digest retrieved content immediately — it re-enters context at full size.",
		],
		parameters: RetrieveParams,
		async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
			const cfg = resolveHeadroom(getAdapter());
			const hash = (params as RetrieveArgs).hash?.trim() ?? "";
			if (!isValidHash(hash)) {
				throw new Error("Invalid hash format: expected 24 hex characters, e.g. headroom_retrieve({ hash: \"a1b2c3d4e5f6a1b2c3d4e5f6\" }).");
			}
			const original = await retrieveOriginal(cfg.proxyUrl, hash);
			if (original === null) {
				throw new Error(`No stored original for hash ${hash}. It may have expired from the proxy store and no local backup exists.`);
			}
			return { details: undefined, content: [{ type: "text", text: original }] };
		},
	};
}
