import { FlyflorComponent } from "../../components/index.ts";
import type { RuntimeMode as RuntimeModeType } from "./enums.ts";

/**
 * Runtime mode component.
 *
 * This keeps mode as an explicit runtime boundary while still allowing modules
 * to inspect the scalar protocol value without a string token registry.
 */
export class RuntimeModeComponent extends FlyflorComponent {
    public constructor(public readonly value: RuntimeModeType) {
        super();
    }

    public is(mode: RuntimeModeType): boolean {
        return this.value === mode;
    }
}
