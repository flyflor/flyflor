import { ConfigComponent } from './component';

/**
 * Returns the container-resolved config component.
 * With reflect-metadata injection the container builds and initializes `ConfigComponent` itself; this
 * composable simply names the dependency for call sites that prefer a `useXxx()` accessor.
 * @param component - the injected config component.
 * @returns the same component, ready to read once `@Init` has run.
 */
export function useConfigComponent(component: ConfigComponent): ConfigComponent {
    return component;
}
