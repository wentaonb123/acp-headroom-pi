import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { HeadroomStage } from "./stage.js";
import type { ResolvedHeadroom } from "./config.js";
export declare function statusText(stage: HeadroomStage, cfg: ResolvedHeadroom): string | undefined;
/** 1234 → "1.2k"; keeps the status line one line at any session length. */
export declare function formatTokens(n: number): string;
export declare class HeadroomStatus {
    private ui;
    /** Attach to a UI-capable context (TUI/RPC). No-op otherwise. */
    attach(ui: ExtensionUIContext, hasUI: boolean): void;
    /** Re-render from current stage + config state. Safe to call anywhere. */
    update(stage: HeadroomStage, cfg: ResolvedHeadroom): void;
    detach(): void;
}
