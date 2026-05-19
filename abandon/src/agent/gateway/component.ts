import { FlyflorComponent } from "../../components/index.ts";
import type { ChannelName } from "../../protocol/contracts/index.ts";
import type { ChannelAdapter } from "./channels/types.ts";

/**
 * Gateway adapter registry component.
 *
 * The registry owns the active channel adapter map for this runtime instance.
 * Callers use methods instead of mutating a raw map unless they are at the
 * gateway composition boundary.
 */
export class AdaptersComponent extends FlyflorComponent {
    public constructor(private readonly adapters: Map<ChannelName, ChannelAdapter>) {
        super();
    }

    public get(name: ChannelName): ChannelAdapter | undefined {
        return this.adapters.get(name);
    }

    public has(name: ChannelName): boolean {
        return this.adapters.has(name);
    }

    public entries(): IterableIterator<[ChannelName, ChannelAdapter]> {
        return this.adapters.entries();
    }

    public values(): IterableIterator<ChannelAdapter> {
        return this.adapters.values();
    }

    public asMap(): Map<ChannelName, ChannelAdapter> {
        return this.adapters;
    }
}
