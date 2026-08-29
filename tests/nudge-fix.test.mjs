// 验证 nudge bug 修复：T3 count 门在 growth 为负时也能触发（原 bug：嵌在 growthReady 内，负 growth 永久死锁）
import { createCore, defaultConfig, createInitialState, defaultCountTokens } from "acp-kernel";
import assert from "node:assert";

const core = createCore({ countTokens: defaultCountTokens });

function baseConfig() {
  const config = defaultConfig(200000, {});
  config.compress.enabled = true;
  config.tiers.enabled = true;
  config.tiers.tier2Trigger = 5;
  config.tiers.tier3Trigger = 10;
  return config;
}

// 构造 15 个 tier-2 块（T3 的目标块），模拟用户会话的 "T3 15 blocks (count)"
function stateWith15T2Blocks() {
  let state = createInitialState({});
  const blocks = [];
  for (let i = 0; i < 15; i++) {
    blocks.push({
      id: `b2xx-${i}`,
      tier: 2,
      summary: `tier2 summary ${i}: `.repeat(40), // ~4K chars => ~1K tokens
      effectiveMessageIds: [`m${100 + i}`],
      directMessageIds: [`m${100 + i}`],
      directBlockIds: [],
      ancestorBlocks: [],
      childBlocks: [],
      createdAt: Date.now() - (15 - i) * 60_000,
      tokens: 1000,
      chars: 4000,
    });
  }
  return { state, blocks };
}

// 模拟 nudge 状态：上次 nudge 显示在 tokenCount=140K 时（压缩回落后当前只有 80K => growth = -60K 永久为负）
// 这就是用户报告的 "growth -59986 < floor 22500" 场景
function runNudge(when, nudgeState, blocks) {
  const config = baseConfig();
  const state = {
    ...createInitialState({}),
    blocks,
    nudge: { ...nudgeState },
  };
  // nudge 需要 messages 非空且含所有块引用的消息 id（否则 syncBlocks 去活块）
  const messages = Array.from({ length: 15 }, (_, i) => ({ role: "user", content: "test", id: `m${100 + i}` }));
  const res = core.processTurn({
    config,
    state,
    messages,
    tokenCount: when,
    renderTags: "all",
  });
  return res;
}

// ---- 场景 A：修复前死锁场景（count 门达标但 growth 为负）----
// lastNudgeShownTokens=140000（上次 nudge 显示时的 tokenCount），当前 tokenCount=80000
// => growthSinceReference = max(0, 80000-140000) = 0 < 22500 => growthReady=false
// 但 T3 count=15 >= tier3Trigger=10 应该触发！
{
  const { state, blocks } = stateWith15T2Blocks();
  const nudgeState = {
    lastPerMessageNudgeTokens: 140000,
    lastNudgeShownTokens: 140000,
    lastShownByTier: { 1: 140000 },
  };
  const res = runNudge(80000, nudgeState, blocks);
  const n = res.nudge;
  console.log("场景A (growth负+T3达标): shouldInject=", n.shouldInject, " tier=", n.tier, " reason=", n.reason);
  // 断言：修复后必须注入 T3
  assert.equal(n.shouldInject, true, "A: 应注入 nudge");
  assert.equal(n.tier, 3, "A: 应为 T3");
}

// ---- 场景 B：growth 正常且 T3 达标仍触发 ----
{
  const { state, blocks } = stateWith15T2Blocks();
  const nudgeState = {
    lastPerMessageNudgeTokens: 40000,
    lastNudgeShownTokens: 40000,
    lastShownByTier: {},
  };
  const res = runNudge(100000, nudgeState, blocks);
  const n = res.nudge;
  console.log("场景B (growth正常+T3达标): shouldInject=", n.shouldInject, " tier=", n.tier, " reason=", n.reason);
  assert.equal(n.shouldInject, true, "B: 应注入 nudge");
  assert.equal(n.tier, 3, "B: 应为 T3");
}

// ---- 场景 C：T1 大但 growth 为负且 T2/T3 未达标 ----
// 语义：growth 为负 = 刚压缩过/回落，T1 死锁时 nudge 不注入（守旧但不再永久死锁——因为 count 门独立了）
{
  const config = baseConfig();
  const state = {
    ...createInitialState({}),
    blocks: [], // 无 T2 块
    nudge: {
      lastPerMessageNudgeTokens: 140000,
      lastNudgeShownTokens: 140000,
      lastShownByTier: {},
    },
  };
  const messages = [{ role: "user", content: "test", id: "m200" }];
  const res = core.processTurn({ config, state, messages, tokenCount: 80000, renderTags: "all" });
  const n = res.nudge;
  console.log("场景C (growth负+T1大): shouldInject=", n.shouldInject, " tier=", n.tier, " reason=", n.reason);
  assert.equal(n.shouldInject, false, "C: 不应注入（无达标 count 门）");
}

console.log("\n✅ 全部通过：count 门已独立于 growth，压缩回落不再死锁");