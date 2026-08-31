import type { RegisteredCommand } from "@earendil-works/pi-coding-agent";
import type { AcpRuntime } from "./runtime.js";
type CommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;
export declare function makeCommands(runtime: AcpRuntime): Array<{
    name: string;
    options: CommandOptions;
}>;
export {};
