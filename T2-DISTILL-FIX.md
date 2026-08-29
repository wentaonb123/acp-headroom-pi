# T2 Distillation Deadlock — Root Cause & Fix (2025-08-29)

## 症状
- 会话里反复出现 `[TIER 2 DISTILLATION TRIGGER]` 但实际从未执行过 T2 蒸馏（76 个 active T1 块、0 个 T2/T3）。
- 手动 `compress b1..b81` 被拒：`Requested range(s) already compressed ... remaining compressible content 0 chars < min 5000. Nothing to do. Current active blocks span b1..bN`.
- nudge 显示 `ready: T2 77643, blocked: T2 (cadence)` 或干脆不注入。

## 根因（acp-kernel v0.0.32）
`decideNudge()` 的 growthReady 分支：

```js
// v0.0.32 (deadlocked)
if (t1Eff >= nudgeGrowthTokens) { inject T1; }
else if (t2Pen >= tier2Threshold && t2Pen > t1Eff) { inject T2; }  // ← 无计数门
```

活跃会话里 T1 pending 永远 ≥ nudgeGrowthTokens（每轮都能压 T1），
T2 分支的 `t2Pen > t1Eff` 永不成立 → T2 nudge 永不注入 → 蒸馏从未发生。

**v0.0.46 修复**（billion-context-pi 用的版本）：

```js
if (t1Eff >= nudgeGrowthTokens) { inject T1; }
else if (config.tiers.enabled && (t2Count >= config.tiers.tier2Trigger /* ← 计数门 */ || t2Pen >= tier2Threshold && t2Pen > t1Eff)) { inject T2; }
```

tier2Trigger 默认 5：一旦活跃 T1 块数 ≥5，T2 nudge 无条件注入（不受 `t2Pen > t1Eff` 优先级压制）。

## 另一个误判澄清
`compress b1..b81` 失败并非内核故障：b1..b81 中夹着已 inactive 的
中间块（如 b34/b23/b52，被 absorb），`resolveAnchorIndex` 把它们当
consumed 分类 → `consumeRanges>0` → gate 的 `!hasBlockBoundaryRange && totalRangeChars<5000` 拒绝。
**用纯 active 块号连续区段做块边界压缩即可**，如 `b1..b25`（若要压
则必须包含真正 active 的起始/结束块）。

## 修复
1. acp-headroom-pi 依赖升级 `npm install acp-kernel@0.0.46 --save-exact`
2. API 完全兼容（21 个符号全部在 v0.0.46 导出，typecheck 通过；新增的
   `applyPairBoundaryAdjustments`/`isSummaryMessageId` 过滤是增强非破坏）
3. `npm run build` 重建 dist（tsup），dist/index.js 已含计数门
4. 测试：compat/config/compress-tool 全绿（EPERM symlink 是 Windows 无
   权限的环境性失败，与升级无关）
5. commit 067a7ba pushed

## 生效条件
- 本 pi 会话通过 `~/.pi/agent/settings.json` 的 `"packages"` 加载
  acp-headroom-pi 扩展，重启 pi 后新 dist 生效。
- T2 nudge 现在会在 T1 块数 ≥5 时自动触发（文案：
  `T2 distill ready: ${t2Count} tier-1 blocks >= tier2Trigger 5 (...)`）。

## tier2Trigger / tier3Trigger 配置化（2025-08-29 补充）

新增 `compress.tier2Trigger`（默认 5）与 `compress.tier3Trigger`（默认 10）配置项，
支持三层级级联（global > provider > model），映射到 kernel `tiers.tier2Trigger` / `tiers.tier3Trigger`。

示例 `~/.pi/acp.json`：

```json
{
  "compress": {
    "tier2Trigger": 10
  }
}
```

实现：src/config.ts `CompressSettings` + `mergeCompress` + `resolveConfig` 三处接线；
tests/config.test.ts 新增 3 测试（映射/保留默认/级联）。commit 后重启 pi 生效。
