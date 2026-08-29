# Nudge Count-Gate Deadlock Fix

**Date**: 2026-08-29 (session 2)
**Kernel**: acp-kernel v0.0.46 (patched in `node_modules/acp-kernel/dist/index.js` + rebuilt extension `dist/index.js`)

## Symptom (user report)

Status/nudge line showed:

```
Nudge: idle — growth -59986 < floor 22500, ready: T1 80064, T3 15 blocks (count), blocked: T1 (cadence)
```

Context only ~16.8% used, but **no T2/T3 nudge ever triggered** despite `T3 15 blocks (count)` — i.e. 15 tier-2 blocks load-bearing ≥ `tier3Trigger: 10`.

## Root cause — TWO deadlocks

### 1. Count gates nested inside `growthReady`

In `decideNudge` (kernel 0.0.46), the branch order was:

```js
} else if (growthReady) {            // growthSinceReference >= growthFloor
    if (t1Eff >= nudgeGrowthTokens) { ... }
    else if (t2Count >= tier2Trigger || t2Pen >= ...) { ... }   // count gate
    else if (t3Count >= tier3Trigger || t3Pen >= ...) { ... }   // count gate
}
```

The count gates (`t2Count >= tier2Trigger` / `t3Count >= tier3Trigger`) were ONLY checked when `growthReady` was true.

### 2. Growth reference never resets after compression

`growthReference` = `lastNudgeShownTokens > 0 ? lastNudgeShownTokens : baseline > 0 ? baseline : tokenCount`.
`lastNudgeShownTokens` is stamped to `tokenCount` every time a nudge is INJECTED (nudgeNode.run, line ~2223).

- Our session compressed heavily (156K reclaimed in one round).
- tokenCount dropped from ~140K to ~40K — far below the `lastNudgeShownTokens` high-water mark.
- `growthSinceReference = tokenCount - growthReference` became permanently negative.
- `growthFloor = max(minGrowthFloor=20000, minGrowthRatio=0.45 × nudgeGrowthTokens=50000) = 22500` → `growthReady` never true again.
- The existing reset guard `if (baseline > 0 && tokenCount < baseline - nudgeGrowthTokens)` required dropping 50K below `baseline` (lastPerMessageNudgeTokens) — too strict, and it resets the wrong field.

Net effect: **negative growth permanently disables ALL nudge tiers** in a session that has compressed once. "growth 负数" is expected after compression, not a healthy idle state.

## Fix (in `node_modules/acp-kernel/dist/index.js`)

1. **Clamp negative growth**: `const growthSinceReference = Math.max(0, tokenCount - growthReference);`
   — compression-induced fallback is treated as "new baseline", not permanent debt.

2. **Count gates promoted out of `growthReady`**: new independent branch, checked before `growthReady`:

```js
} else if (config.tiers.enabled && (t3Count >= config.tiers.tier3Trigger || t2Count >= config.tiers.tier2Trigger)) {
    const tier = t3Count >= config.tiers.tier3Trigger ? 3 : 2;   // deeper tier wins
    const lastShown = state.nudge.lastShownByTier[tier] ?? 0;
    const cadenceMet = lastShown === 0 || tokenCount <= lastShown || tokenCount - lastShown >= growthFloor;
    if (cadenceMet) { injectedTier = tier; ... }
}
```

   - Count gates fire on block count alone — independent of token growth.
   - Cadence: `tokenCount <= lastShown` counts as elapsed (compression reset the baseline), so a compressed session can be nudged again without waiting for 22.5K fresh growth.
   - Removed the count-gate arms from inside `growthReady` (they still have token-threshold arms: `t2Pen >= tier2Threshold && t2Pen > t1Eff`, same relaxed cadence).

3. **Display parity**: the `blocked: Tn (cadence)` hint now also requires `tokenCount > lastShown` — a compressed session is not shown as "blocked".

## Verification

`tests/nudge-fix.test.mjs` (run with `node tests/nudge-fix.test.mjs`):

- **A** (user's real deadlock): growth negative + 15 tier-2 blocks → `shouldInject=true, tier=3, reason="T3 condense ready: 15 tier-2 blocks >= tier3Trigger 10"` ✅ (pre-fix: never injected)
- **B**: growth normal + T3 count met → injects T3 ✅
- **C**: growth negative + no met count gate → no inject (conservative semantics preserved) ✅

Full suite: **430 pass / 2 fail** — the 2 fails are the pre-existing Windows symlink tests (`EPERM: operation not permitted, symlink ...`, tests/decompress-tool.test.ts:155) — environment-only, unrelated.

## Notes

- Extension bundles kernel via tsup from `node_modules/acp-kernel` — the patch lives in node_modules; run `npm run build` to rebuild `dist/index.js` for the running extension.
- Unrelated test-isolation fix included: `tests/e2e-compress-config.test.ts` "without a config file" now also sets `process.env.USERPROFILE` (Windows `os.homedir()` prefers USERPROFILE over HOME — the test previously read the real user's `C:\Users\12546\.pi\acp.json` `{compress:{tier2Trigger:5}}`).
- **Restart the pi session for the rebuilt `dist/` to load.**