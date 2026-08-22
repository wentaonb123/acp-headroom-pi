import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultCountTokens } from "acp-kernel";
import {
  DensityEstimator,
  DENSITY_MIN,
  DENSITY_MAX,
  MIN_DELTA_EST,
  INITIAL_DENSITY,
} from "../src/density.js";

const MODEL = "deepseek-v4-flash";

function est(model = MODEL) {
  return new DensityEstimator();
}

test("initial density is 1 and unknown model returns 1", () => {
  const d = est();
  assert.equal(d.densityFor(MODEL), INITIAL_DENSITY);
  assert.equal(d.densityFor("other-model"), INITIAL_DENSITY);
});

test("first update only anchors, no sample", () => {
  const d = est();
  d.update(MODEL, 100_000, 50_000);
  assert.equal(d.densityFor(MODEL), INITIAL_DENSITY); // 尚无样本
});

test("converges to true density after 2 consistent rounds (anchor method)", () => {
  const d = est();
  // 真实密度 1.6：real 增长 1600 / est 增长 1000
  d.update(MODEL, 100_000, 50_000); // anchor: real=100k, est=50k
  d.update(MODEL, 101_600, 51_000); // instant = 1600/1000 = 1.6, pending
  d.update(MODEL, 103_200, 52_000); // instant = 1600/1000 = 1.6, confirm → adopt
  assert.equal(d.densityFor(MODEL), 1.6);
});

test("clamps instant density to [0.5, 2.5]", () => {
  const d = est();
  d.update(MODEL, 100_000, 50_000); // anchor
  // instant = 5000/1000 = 5 → clamp 2.5
  d.update(MODEL, 105_000, 51_000);
  d.update(MODEL, 110_000, 52_000); // confirm 2.5
  assert.equal(d.densityFor(MODEL), DENSITY_MAX);

  const d2 = est();
  d2.update(MODEL, 100_000, 50_000);
  // instant = 500/1000 = 0.5 → 正好下界
  d2.update(MODEL, 100_500, 51_000);
  d2.update(MODEL, 101_000, 52_000); // confirm 0.5
  assert.equal(d2.densityFor(MODEL), DENSITY_MIN);
});

test("Δest below MIN_DELTA_EST skips the sample", () => {
  const d = est();
  d.update(MODEL, 100_000, 50_000); // anchor
  // Δest = 30 < 50 → skip（真实比值即使异常大也不采纳）
  d.update(MODEL, 100_200, 50_030);
  assert.equal(d.densityFor(MODEL), INITIAL_DENSITY);
});

test("negative Δest (compression round) is skipped and does not corrupt anchor", () => {
  const d = est();
  d.update(MODEL, 100_000, 50_000); // anchor
  d.update(MODEL, 101_600, 51_000); // instant 1.6 pending
  // 压缩：est 大跌，real 也跌（provider 滞后或同步）
  d.update(MODEL, 100_000, 20_000); // Δest = -31_000 → skip
  // 压缩后第一轮 postCompression=true → 跳过
  d.update(MODEL, 100_000, 20_000, true);
  // 下一轮：在干净的压缩后基准上重新锚定（锚点不再跨越压缩事件）
  d.update(MODEL, 101_600, 51_000); // re-anchor，不采样
  d.update(MODEL, 103_200, 52_000); // Δ=(1600,1000) → 1.6 pending
  d.update(MODEL, 104_800, 53_000); // 1.6 confirm → adopt
  assert.equal(d.densityFor(MODEL), 1.6);
});

test("postCompression skips exactly one round after flag", () => {
  const d = est();
  d.update(MODEL, 100_000, 50_000); // anchor
  d.update(MODEL, 101_600, 51_000, true); // postCompression=true → set skip, return
  d.update(MODEL, 101_600, 51_000); // 下一轮：skip 生效，清除标志，不采样
  d.update(MODEL, 103_200, 52_000); // 正常采样：instant=1.6 pending
  d.update(MODEL, 104_800, 53_000); // confirm → adopt
  assert.equal(d.densityFor(MODEL), 1.6);
});

test("a single anomalous round resets confirmation (C1 ±20%)", () => {
  const d = est();
  d.update(MODEL, 100_000, 50_000); // anchor
  d.update(MODEL, 101_600, 51_000); // Δ=(1600,1000) instant 1.6, pending(1.6), count=1, anchor→(101.6k,51k)
  // 异常轮：Δreal=2200 → instant 2.2，|2.2-1.6|/1.6 = 0.375 > 0.2 → pending 重置 2.2
  d.update(MODEL, 103_800, 52_000);
  assert.equal(d.densityFor(MODEL), INITIAL_DENSITY); // 尚未采纳
  // 回到 1.6：Δ=(1600,1000) instant 1.6，|1.6-2.2|/2.2 = 0.273 > 0.2 → pending 重置回 1.6
  d.update(MODEL, 105_400, 53_000);
  // 确认轮：instant 1.6 与 pending(1.6) 一致 → count=2 → adopt 1.6
  d.update(MODEL, 107_000, 54_000);
  assert.equal(d.densityFor(MODEL), 1.6);
});

test("models are isolated (per-model storage)", () => {
  const d = est();
  d.update(MODEL, 100_000, 50_000);
  d.update(MODEL, 101_600, 51_000);
  d.update(MODEL, 103_200, 52_000); // deepseek → 1.6
  assert.equal(d.densityFor(MODEL), 1.6);

  const other = "gpt-4";
  d.update(other, 100_000, 50_000);
  d.update(other, 100_800, 51_000); // instant 0.8 pending
  d.update(other, 101_600, 52_000); // confirm → adopt 0.8
  assert.equal(d.densityFor(other), 0.8);
  assert.equal(d.densityFor(MODEL), 1.6); // 互不影响
});

test("resetModel clears only that model", () => {
  const d = est();
  d.update(MODEL, 100_000, 50_000);
  d.update(MODEL, 101_600, 51_000);
  d.update(MODEL, 103_200, 52_000);
  const other = "gpt-4";
  d.update(other, 100_000, 50_000);
  d.update(other, 100_800, 51_000);
  d.update(other, 101_600, 52_000);
  d.resetModel(MODEL);
  assert.equal(d.densityFor(MODEL), INITIAL_DENSITY);
  assert.equal(d.densityFor(other), 0.8);
});

test("estimateWithDensity scales CJK-aware count by density", () => {
  const d = est();
  // 校准到 1.6
  d.update(MODEL, 100_000, 50_000);
  d.update(MODEL, 101_600, 51_000);
  d.update(MODEL, 103_200, 52_000);
  const zh = "这是一个中文测试消息用于验证密度系数。".repeat(10);
  const base = defaultCountTokens(zh);
  assert.equal(d.estimateWithDensity(MODEL, zh), Math.round(base * 1.6));
});

test("estimateWithDensity at density=1 avoids float rounding", () => {
  const d = est();
  const zh = "这是一个中文测试消息用于验证密度系数。".repeat(10);
  assert.equal(d.estimateWithDensity(MODEL, zh), defaultCountTokens(zh)); // defaultCountTokens 原值
});

test("null realTotal freezes anchors without corrupting", () => {
  const d = est();
  d.update(MODEL, 100_000, 50_000); // anchor
  d.update(MODEL, 101_600, 51_000); // 1.6 pending
  d.update(MODEL, null, 52_000); // 无 usage → 跳过
  d.update(MODEL, 103_200, 52_000); // 与 anchor 差 3200/2000 = 1.6 → confirm → adopt
  assert.equal(d.densityFor(MODEL), 1.6);
});

// ─── post-compression re-anchoring (fixes the pre-compression-anchor dead zone) ───

test("re-anchors on the round AFTER postCompression — no dead zone", () => {
  const d = est();
  d.update(MODEL, 300_000, 200_000); // anchor
  d.update(MODEL, 301_600, 201_000); // 1.6 pending
  d.update(MODEL, 303_200, 202_000); // 1.6 adopt
  assert.equal(d.densityFor(MODEL), 1.6);
  // compression frees 100K est / 150K real; next context round reports the
  // (still stale, pre-compression-sized) usage
  d.update(MODEL, 303_000, 100_000, true); // postCompression → set skip
  // one round later: usage caught up to the compressed context → re-anchor here
  d.update(MODEL, 151_500, 101_000);
  // resampling starts from the NEW anchor immediately (no 100K regrowth wait)
  d.update(MODEL, 153_100, 102_000); // Δ=(1600,1000) → 1.6 pending
  d.update(MODEL, 154_700, 103_000); // 1.6 confirm → adopt
  assert.equal(d.densityFor(MODEL), 1.6);
});

test("re-anchoring discards the pre-compression pending confirmation", () => {
  const d = est();
  d.update(MODEL, 300_000, 200_000); // anchor
  d.update(MODEL, 301_600, 201_000); // 1.6 pending (count=1) — not yet adopted
  // compress before confirmation completes
  d.update(MODEL, 301_600, 100_000, true); // postCompression → skip
  d.update(MODEL, 151_600, 101_000); // re-anchor; stale pending(1.6) must be dropped
  // if the stale pending survived, this sample would be the 2nd confirmation
  // and adopt immediately — it must instead start a FRESH count=1
  d.update(MODEL, 153_200, 102_000); // 1.6 → pending only
  assert.equal(d.densityFor(MODEL), 1, "fresh confirmation cycle must not adopt on its first sample");
  d.update(MODEL, 154_800, 103_000); // 2nd consistent sample → adopt
  assert.equal(d.densityFor(MODEL), 1.6);
});

test("null usage on the re-anchor round defers the re-anchor without losing the flag", () => {
  const d = est();
  d.update(MODEL, 300_000, 200_000);
  d.update(MODEL, 301_600, 201_000);
  d.update(MODEL, 303_200, 202_000); // adopt 1.6
  d.update(MODEL, 303_200, 100_000, true); // postCompression
  d.update(MODEL, null, 100_500); // usage missing → flag must persist
  d.update(MODEL, 151_500, 101_000); // re-anchor now
  d.update(MODEL, 153_100, 102_000); // pending
  d.update(MODEL, 154_700, 103_000); // adopt
  assert.equal(d.densityFor(MODEL), 1.6);
});
