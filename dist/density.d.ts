export declare const DENSITY_MIN = 0.5;
export declare const DENSITY_MAX = 2.5;
export declare const MIN_DELTA_EST = 50;
export declare const CONFIRM_RATIO = 0.2;
export declare const INITIAL_DENSITY = 1;
export declare class DensityEstimator {
    private models;
    /** 重置指定模型（模型切换/会话开始时调用）。 */
    resetModel(modelId: string): void;
    /** 返回当前密度系数（未知模型返回初始 1）。 */
    densityFor(modelId: string): number;
    /**
     * 每轮 context 事件调用。realTotal 为 provider 真实 usage（可空），
     * estTotal 为本地估算总 token。postCompression 为压缩刚发生标志。
     */
    update(modelId: string, realTotal: number | null, estTotal: number, postCompression?: boolean): void;
    /** 注入器：估算文本 token = defaultCountTokens × density。 */
    estimateWithDensity(modelId: string, text: string): number;
}
