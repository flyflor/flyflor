import {
    type ArchitectureLayer as ArchitectureLayerType,
    type ComponentKind as ComponentKindType,
} from "../../../protocol/contracts/index.ts";
import { type ComponentConstructor, type ComponentMetadata, readComponentMetadata } from "../composition/index.ts";

export class ComponentRegistry {
    metadataOf(target: Function): ComponentMetadata | undefined {
        return readComponentMetadata(target);
    }

    assertKind(target: Function, kind: ComponentKindType): ComponentMetadata {
        const metadata = readComponentMetadata(target);
        if (!metadata || metadata.kind !== kind) {
            throw new Error(`Missing @${kind} metadata on ${target.name}`);
        }
        return metadata;
    }

    assertLayer(target: Function, layer: ArchitectureLayerType): ComponentMetadata {
        const metadata = readComponentMetadata(target);
        if (!metadata || metadata.layer !== layer) {
            throw new Error(`Missing ${layer} layer metadata on ${target.name}`);
        }
        return metadata;
    }

    assertProvider(target: Function): ComponentMetadata {
        const metadata = readComponentMetadata(target);
        if (!metadata?.provider) {
            throw new Error(`Missing @Provide metadata on ${target.name}`);
        }
        return metadata;
    }

    create<TComponent, TArgs extends unknown[]>(
        target: ComponentConstructor<TComponent, TArgs>,
        ...args: TArgs
    ): TComponent {
        return new target(...args);
    }
}

export const componentRegistry = new ComponentRegistry();
export { ComponentRegistry as FpcComponentFactory };
export const fpcComponents = componentRegistry;
