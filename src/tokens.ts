import { defaultCountTokens, type CoreMessage } from "acp-kernel";

export function collectCoveredMessageIds(state: { blocks: { active: boolean; effectiveMessageIds: string[] }[] }): Set<string> {
  const ids = new Set<string>();
  for (const b of state.blocks) {
    if (!b.active) continue;
    for (const id of b.effectiveMessageIds) ids.add(id);
  }
  return ids;
}

export function estimateTokens(messages: CoreMessage[], coveredIds?: Set<string>): number {
  let tokens = 0;
  for (const m of messages) {
    if (m.toolName === "compress") continue;
    if (coveredIds?.has(m.id)) continue;
    tokens += defaultCountTokens(m.text ?? "");
  }
  return tokens;
}

/** Scale a raw (uncalibrated) sent-view estimate by the per-model density
 *  learned from provider usage (density = real/estimate). Used for nudge /
 *  usage / emergency arbitration at every processTurn site so the decision
 *  runs on the provider-anchored scale; the estimator itself is always fed
 *  the RAW estimate — see density.ts. */
export function calibrateTokens(estimate: number, density: number): number {
  return density === 1 ? estimate : Math.round(estimate * density);
}

/** Id of the last user-role entry — used as a per-turn key so a nudge prints at
 *  most once per turn. Returns undefined if there is no user message yet. */
export function lastUserMessageId(entries: { id: string; message?: { role?: string } }[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.message?.role === "user") return e.id;
  }
  return undefined;
}
