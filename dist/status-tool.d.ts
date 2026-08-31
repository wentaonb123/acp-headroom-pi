import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AcpRuntime } from "./runtime.js";
declare const StatusParams: Type.TObject<{
    scope: Type.TOptional<Type.TUnion<[Type.TLiteral<"compressed">, Type.TLiteral<"uncompressed">]>>;
    view: Type.TOptional<Type.TUnion<[Type.TLiteral<"ranges">, Type.TLiteral<"messages">]>>;
    tool: Type.TOptional<Type.TString>;
    sort: Type.TOptional<Type.TUnion<[Type.TLiteral<"size">, Type.TLiteral<"time">, Type.TLiteral<"tool">, Type.TLiteral<"age">]>>;
    limit: Type.TOptional<Type.TNumber>;
}>;
export declare function makeStatusTool(runtime: AcpRuntime): ToolDefinition<typeof StatusParams>;
export {};
