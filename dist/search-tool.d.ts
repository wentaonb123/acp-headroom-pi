import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AcpRuntime } from "./runtime.js";
declare const SearchParams: Type.TObject<{
    query: Type.TString;
    limit: Type.TOptional<Type.TNumber>;
}>;
export declare function makeSearchTool(runtime: AcpRuntime): ToolDefinition<typeof SearchParams>;
export {};
