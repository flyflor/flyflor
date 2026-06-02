import { CapillaryModule } from "./module.ts";

/**
 * Returns the capillary module resolved by the IoC composition root.
 * `module` already owns bootstrap-created RxJS and listener dependencies.
 */
export function useCapillaryModule(module: CapillaryModule): CapillaryModule {
    return module;
}
