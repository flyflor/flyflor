import { type ComponentKind as ComponentKindType, type FpcLayer as FpcLayerType } from "../contracts/index.ts";
import { type ComponentMetadata, type FpcComponentConstructor, readComponentMetadata } from "../composition/index.ts";

export class FpcComponentFactory {
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

    assertLayer(target: Function, layer: FpcLayerType): ComponentMetadata {
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
        target: FpcComponentConstructor<TComponent, TArgs>,
        ...args: TArgs
    ): TComponent {
        return new target(...args);
    }
}

export const fpcComponents = new FpcComponentFactory();
