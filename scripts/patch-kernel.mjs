#!/usr/bin/env node
// Idempotent patch for acp-kernel's decidedNudge negative-growth deadlock.
// NUDGE-COUNT-GATE-FIX.md: after a compression tokenCount falls below
// lastNudgeShownTokens (the high-water stamp), so growthSinceReference goes
// negative and — since all soft-nudge gates sit under growthReady — no nudge
// ever fires again despite ready compressible content. This patch:
//   1. clamps growthSinceReference at 0 (compression fallback = new baseline)
//   2. promotes the T2/T3 count gates out of growthReady (independent branch)
//   3. relaxed cadence: tokenCount <= lastShown counts as elapsed
//   4. "blocked: Tn (cadence)" hint requires tokenCount > lastShown
// Runs on every `npm install` (postinstall) so the manual node_modules patch
// can never be silently lost again.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "node_modules", "acp-kernel", "dist", "index.js");

if (!existsSync(target)) {
  console.log("[patch-kernel] acp-kernel dist not found, skipping");
  process.exit(0);
}

let src = readFileSync(target, "utf8");
const before = src;
let applied = 0;

// 1. clamp growthSinceReference at 0
const CLAMP_OLD = "  const growthSinceReference = tokenCount - growthReference;";
const CLAMP_NEW = `  // NUDGE-COUNT-GATE-FIX: compression-induced fallback is treated as "new
  // baseline", not permanent debt — negative growth must never block nudges.
  const growthSinceReference = Math.max(0, tokenCount - growthReference);`;
if (!src.includes("Math.max(0, tokenCount - growthReference)")) {
  if (src.includes(CLAMP_OLD)) {
    src = src.replace(CLAMP_OLD, CLAMP_NEW);
    applied++;
  } else {
    console.error("[patch-kernel] WARN: clamp anchor not found — kernel changed?");
  }
}

// 2. promote count gates out of growthReady
const COUNT_GATE_OLD = `  } else if (growthReady) {
    if (t1Eff >= nudgeGrowthTokens) {
      injectedTier = 1;
      injectedReason = \`T1 effective \${t1Eff} >= \${nudgeGrowthTokens}, growth \${growthSinceReference}, usage \${Math.round(usage * 100)}%\`;
    } else if (config.tiers.enabled && (t2Count >= config.tiers.tier2Trigger || t2Pen >= tier2Threshold && t2Pen > t1Eff)) {
      const lastShown = state.nudge.lastShownByTier[2] ?? 0;
      const cadenceMet = lastShown === 0 || tokenCount - lastShown >= growthFloor;
      if (cadenceMet) {
        injectedTier = 2;
        injectedReason = t2Count >= config.tiers.tier2Trigger ? \`T2 distill ready: \${t2Count} tier-1 blocks >= tier2Trigger \${config.tiers.tier2Trigger} (\${t2Pen} tokens), usage \${Math.round(usage * 100)}%\` : \`T2 distill ready: \${tiers[2].targetBlocks.length} tier-1 blocks (\${t2Pen} tokens) >= \${tier2Threshold} (1.5x) and > T1 effective \${t1Eff}, usage \${Math.round(usage * 100)}%\`;
      }
    } else if (config.tiers.enabled && (t3Count >= config.tiers.tier3Trigger || t3Pen >= tier2Threshold && t3Pen > t2Pen && t3Pen > t1Eff)) {
      const lastShown = state.nudge.lastShownByTier[3] ?? 0;
      const cadenceMet = lastShown === 0 || tokenCount - lastShown >= growthFloor;
      if (cadenceMet) {
        injectedTier = 3;
        injectedReason = t3Count >= config.tiers.tier3Trigger ? \`T3 condense ready: \${t3Count} tier-2 blocks >= tier3Trigger \${config.tiers.tier3Trigger} (\${t3Pen} tokens), usage \${Math.round(usage * 100)}%\` : \`T3 condense ready: \${tiers[3].targetBlocks.length} tier-2 blocks (\${t3Pen} tokens) >= \${tier2Threshold} (1.5x) and > T2 \${t2Pen} and > T1 effective \${t1Eff}, usage \${Math.round(usage * 100)}%\`;
      }
    }
  }`;
const COUNT_GATE_NEW = `  } else if (config.tiers.enabled && (t3Count >= config.tiers.tier3Trigger || t2Count >= config.tiers.tier2Trigger)) {
    // NUDGE-COUNT-GATE-FIX: count gates fire on block count alone — independent
    // of token growth (were nested inside growthReady, so any session that
    // compressed once had permanently negative growth and never nudged again).
    const tier = t3Count >= config.tiers.tier3Trigger ? 3 : 2; // deeper tier wins
    const lastShown = state.nudge.lastShownByTier[tier] ?? 0;
    const cadenceMet = lastShown === 0 || tokenCount <= lastShown || tokenCount - lastShown >= growthFloor;
    if (cadenceMet) {
      injectedTier = tier;
      injectedReason = tier === 3 ? \`T3 condense ready: \${t3Count} tier-2 blocks >= tier3Trigger \${config.tiers.tier3Trigger} (\${t3Pen} tokens), usage \${Math.round(usage * 100)}%\` : \`T2 distill ready: \${t2Count} tier-1 blocks >= tier2Trigger \${config.tiers.tier2Trigger} (\${t2Pen} tokens), usage \${Math.round(usage * 100)}%\`;
    }
  } else if (growthReady) {
    if (t1Eff >= nudgeGrowthTokens) {
      injectedTier = 1;
      injectedReason = \`T1 effective \${t1Eff} >= \${nudgeGrowthTokens}, growth \${growthSinceReference}, usage \${Math.round(usage * 100)}%\`;
    } else if (config.tiers.enabled && t2Pen >= tier2Threshold && t2Pen > t1Eff) {
      // token-threshold arm only (count gate promoted above); same relaxed cadence
      const lastShown = state.nudge.lastShownByTier[2] ?? 0;
      const cadenceMet = lastShown === 0 || tokenCount <= lastShown || tokenCount - lastShown >= growthFloor;
      if (cadenceMet) {
        injectedTier = 2;
        injectedReason = \`T2 distill ready: \${tiers[2].targetBlocks.length} tier-1 blocks (\${t2Pen} tokens) >= \${tier2Threshold} (1.5x) and > T1 effective \${t1Eff}, usage \${Math.round(usage * 100)}%\`;
      }
    } else if (config.tiers.enabled && t3Pen >= tier2Threshold && t3Pen > t2Pen && t3Pen > t1Eff) {
      const lastShown = state.nudge.lastShownByTier[3] ?? 0;
      const cadenceMet = lastShown === 0 || tokenCount <= lastShown || tokenCount - lastShown >= growthFloor;
      if (cadenceMet) {
        injectedTier = 3;
        injectedReason = \`T3 condense ready: \${tiers[3].targetBlocks.length} tier-2 blocks (\${t3Pen} tokens) >= \${tier2Threshold} (1.5x) and > T2 \${t2Pen} and > T1 effective \${t1Eff}, usage \${Math.round(usage * 100)}%\`;
      }
    }
  }`;
if (!src.includes("deeper tier wins")) {
  if (src.includes(COUNT_GATE_OLD)) {
    src = src.replace(COUNT_GATE_OLD, COUNT_GATE_NEW);
    applied++;
  } else {
    console.error("[patch-kernel] WARN: count-gate anchor not found — kernel changed?");
  }
}

// 3. blocked: hint requires tokenCount > lastShown (a compressed session must
//    not be shown as cadence-blocked)
const BLOCKED_OLD =
  "tokenCount - (state.nudge.lastShownByTier[t] ?? 0) < growthFloor";
const BLOCKED_NEW =
  "tokenCount > (state.nudge.lastShownByTier[t] ?? 0) && tokenCount - (state.nudge.lastShownByTier[t] ?? 0) < growthFloor";
if (!src.includes(BLOCKED_NEW)) {
  if (src.includes(BLOCKED_OLD) && !src.includes(BLOCKED_NEW)) {
    src = src.replace(BLOCKED_OLD, BLOCKED_NEW);
    applied++;
  } else {
    console.error("[patch-kernel] WARN: blocked-hint anchor not found — kernel changed?");
  }
}

if (src !== before) {
  writeFileSync(target, src);
  console.log(`[patch-kernel] patched acp-kernel (${applied} replacement(s))`);
} else {
  console.log("[patch-kernel] already patched, no-op");
}