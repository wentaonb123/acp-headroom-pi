/**
 * Search index — bridges pi's session log into acp-kernel's search.
 *
 * Builds SearchDoc[] from:
 *  1. All compression blocks (active AND inactive) — via blockDocs()
 *  2. Historical messages that compression folded into a block summary.
 *
 * Which messages are searchable? Those covered by SOME block's
 * effectiveMessageIds — i.e. messages that were compressed into a summary and
 * are no longer individually visible. Messages still live in context (not in
 * any block) are skipped: the model can already see them.
 *
 * We deliberately do NOT use pi's buildContextEntries for the visible check:
 * ACP prunes messages itself (no pi `compaction` entry is written), so pi
 * reports ALL entries as in-context. The ACP state is the source of truth.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type SearchDoc } from "acp-kernel";
import type { CompressionState } from "acp-kernel";
export declare function buildSearchDocs(ctx: ExtensionContext, state: CompressionState): SearchDoc[];
