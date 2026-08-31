import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AcpRuntime } from "./runtime.js";
declare const DecompressParams: Type.TObject<{
    blockId: Type.TString;
    full: Type.TOptional<Type.TBoolean>;
    toFile: Type.TOptional<Type.TString>;
    inline: Type.TOptional<Type.TBoolean>;
}>;
export declare function makeDecompressTool(runtime: AcpRuntime): ToolDefinition<typeof DecompressParams>;
export {};
