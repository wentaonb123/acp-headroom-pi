import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ResolvedHeadroom } from "./config.js";
declare const RetrieveParams: Type.TObject<{
    hash: Type.TString;
}>;
export declare function makeRetrieveTool(getConfig: () => ResolvedHeadroom): ToolDefinition<typeof RetrieveParams>;
export {};
