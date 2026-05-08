import type { ChannelName } from "../core/types.ts";
import { ComponentKind, type ComponentKind as ComponentKindType } from "../core/enums.ts";

export interface ComponentMetadata {
    kind: ComponentKindType;
    name: string;
}

const componentMetadata = new WeakMap<Function, ComponentMetadata>();

export function Component(name?: string): ClassDecorator {
    return registerComponent(ComponentKind.Component, name);
}

export function Gateway(name = "gateway"): ClassDecorator {
    return registerComponent(ComponentKind.Gateway, name);
}

export function Channel(name: ChannelName): ClassDecorator {
    return registerComponent(ComponentKind.Channel, name);
}

export function Command(name: string): ClassDecorator {
    return registerComponent(ComponentKind.Command, name);
}

export function getComponentMetadata(target: Function): ComponentMetadata | undefined {
    return componentMetadata.get(target);
}

function registerComponent(kind: ComponentKindType, name?: string): ClassDecorator {
    return (target) => {
        componentMetadata.set(target, {
            kind,
            name: name ?? target.name,
        });
    };
}
