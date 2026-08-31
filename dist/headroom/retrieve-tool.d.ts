import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AdapterConfig } from "../config.js";
declare const RetrieveParams: Type.TObject<{
    hash: Type.TString;
}>;
export declare function makeRetrieveTool(getAdapter: () => AdapterConfig): ToolDefinition<typeof RetrieveParams>;
export {};
