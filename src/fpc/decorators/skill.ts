import { ComponentKind, FpcLayer } from "../contracts/index.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export function Skill(name: string, options: Omit<ComponentDecoratorOptions, "name"> = {}): ClassDecorator {
    return registerComponentMetadata(
        ComponentKind.Skill,
        { ...options, name },
        {
            compatibility: { protocol: "skill.md", source: "codex/openai-compatible-skill" },
            layer: FpcLayer.Extension,
        },
    );
}
