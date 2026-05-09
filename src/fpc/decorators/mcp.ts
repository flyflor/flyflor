import { ComponentKind, FpcLayer } from "../contracts/index.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export function Mcp(name: string, options: Omit<ComponentDecoratorOptions, "name"> = {}): ClassDecorator {
    return registerComponentMetadata(
        ComponentKind.Mcp,
        { ...options, name },
        {
            compatibility: { protocol: "mcp", source: "model-context-protocol" },
            layer: FpcLayer.Extension,
        },
    );
}

export function McpService(name: string, options: Omit<ComponentDecoratorOptions, "name"> = {}): ClassDecorator {
    return registerComponentMetadata(
        ComponentKind.McpService,
        { ...options, name },
        {
            compatibility: { protocol: "mcp-server", source: "model-context-protocol" },
            layer: FpcLayer.Extension,
        },
    );
}
