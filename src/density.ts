/**
 * 累积锚点密度估计器（Phase 2 of token calibration）。
 *
 * 校准 ACP 对"消息字符 → token"的估算密度。kernel 的 T1 pending 用 chars/4
 * 估算中文会低估 2-4 倍（见 docs/token-calibration-plan.md §1），本模块用
 * provider 真实 usage（realTotal）与本地估算（estTotal）的**同窗口累积增量**
 * 算出实时密度系数，注入 countTokens，让 pending/nudge 与实际占用对齐。
 *
 * 设计要点（文档 §3.2/§5 定稿）：
 * - 累积锚点法而非 EMA：Δreal/Δest 同窗口，天然对齐无滞后（评审 D1/D2）
 * - clamp [0.5, 2.5]：没有自然语言密度能超过 2.5 token/char（评审 D3）
 * - 最小 Δest=50 门槛：微消息比值抖动（评审 D4）
 * - ±20% 连续 2 轮确认才采纳：防单轮异常污染锚点（评审 C1）
 * - 压缩后跳过一轮（postCompressionSkip）：Δest 为负 + provider usage 滞后（评审 D7/F1）
 * - per-model 存储 + 模型切换重置（评审 D5/D6）
 */
import { defaultCountTokens } from "acp-kernel";

export const DENSITY_MIN = 0.5;
export const DENSITY_MAX = 2.5;
export const MIN_DELTA_EST = 50;
export const CONFIRM_RATIO = 0.2; // ±20% 确认带
export const INITIAL_DENSITY = 1;

interface Estimator {
  density: number;
  anchorReal: number | null;
  anchorEst: number | null;
  pendingDensity: number | null;
  confirmCount: number;
  postCompressionSkip: boolean;
}

export class DensityEstimator {
  private models = new Map<string, Estimator>();

  /** 重置指定模型（模型切换/会话开始时调用）。 */
  resetModel(modelId: string): void {
    this.models.delete(modelId);
  }

  /** 返回当前密度系数（未知模型返回初始 1）。 */
  densityFor(modelId: string): number {
    return this.models.get(modelId)?.density ?? INITIAL_DENSITY;
  }

  /**
   * 每轮 context 事件调用。realTotal 为 provider 真实 usage（可空），
   * estTotal 为本地估算总 token。postCompression 为压缩刚发生标志。
   */
  update(modelId: string, realTotal: number | null, estTotal: number, postCompression = false): void {
    if (realTotal === null) return; // 无 provider usage，锚点冻结（§5.9）
    let est = this.models.get(modelId);
    if (!est) {
      est = {
        density: INITIAL_DENSITY,
        anchorReal: null,
        anchorEst: null,
        pendingDensity: null,
        confirmCount: 0,
        postCompressionSkip: false,
      };
      this.models.set(modelId, est);
    }

    if (postCompression) {
      // 压缩后第一轮跳过（D7/F1）：provider usage 滞后，Δest 可能为负
      est.postCompressionSkip = true;
      return;
    }
    if (est.postCompressionSkip) {
      est.postCompressionSkip = false;
      // Re-anchor on the clean post-compression basis. The postCompression
      // round's own usage may still reflect the pre-compression size, so the
      // re-anchor happens here (one round later), not on that round. Without
      // it the pre-compression anchor blocks resampling until the estimate
      // regrows past it (long dead zone) and the first crossing sample can
      // be a clamped outlier.
      est.anchorReal = realTotal;
      est.anchorEst = estTotal;
      est.pendingDensity = null;
      est.confirmCount = 0;
      return;
    }
    if (est.anchorReal === null || est.anchorEst === null) {
      // 首轮建立锚点，不产生样本
      est.anchorReal = realTotal;
      est.anchorEst = estTotal;
      return;
    }

    const dReal = realTotal - est.anchorReal;
    const dEst = estTotal - est.anchorEst;
    if (dEst < MIN_DELTA_EST) return; // 增量太小或为负（压缩轮）跳过
    // 每轮采样后都推进锚点（文档 §3.2）：instant 是相邻轮差值，单轮异常只污染该轮
    est.anchorReal = realTotal;
    est.anchorEst = estTotal;

    const instant = clamp(dReal / dEst, DENSITY_MIN, DENSITY_MAX);
    // C1 加固：连续 2 轮 ±20% 内才采纳，防单轮异常污染锚点
    if (est.pendingDensity === null) {
      est.pendingDensity = instant;
      est.confirmCount = 1;
    } else if (Math.abs(instant - est.pendingDensity) / est.pendingDensity <= CONFIRM_RATIO) {
      est.confirmCount += 1;
    } else {
      est.pendingDensity = instant;
      est.confirmCount = 1;
    }
    if (est.confirmCount >= 2) {
      est.density = est.pendingDensity;
      est.confirmCount = 0;
      est.pendingDensity = null;
    }
  }

  /** 注入器：估算文本 token = defaultCountTokens × density。 */
  estimateWithDensity(modelId: string, text: string): number {
    const d = this.densityFor(modelId);
    if (d === 1) return defaultCountTokens(text); // 未校准时不引入浮点误差
    return Math.round(defaultCountTokens(text) * d);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
