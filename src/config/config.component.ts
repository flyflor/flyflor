import { FlyflorComponent } from "../components/index.ts";
import type {
    FlyflorConfig,
    FlyflorPaths,
    GatewayConfig,
    MemoryConfig,
    MetricsConfig,
    ModelConfig,
    RoutingConfig,
    SandboxConfig,
} from "./index.ts";

/**
 * Runtime config component.
 *
 * The component wraps the loaded JSONC snapshot so DI resolves a real runtime
 * boundary, not an empty token. Getters keep existing call sites cheap while
 * `snapshot()` marks the point where code intentionally unwraps raw config.
 */
export class ConfigComponent extends FlyflorComponent implements FlyflorConfig {
    public constructor(public readonly value: FlyflorConfig) {
        super();
    }

    public get gateway(): GatewayConfig {
        return this.value.gateway;
    }

    public get memory(): MemoryConfig {
        return this.value.memory;
    }

    public get metrics(): MetricsConfig {
        return this.value.metrics;
    }

    public get model(): ModelConfig {
        return this.value.model;
    }

    public get paths(): FlyflorPaths {
        return this.value.paths;
    }

    public get routing(): RoutingConfig {
        return this.value.routing;
    }

    public get sandbox(): SandboxConfig {
        return this.value.sandbox;
    }

    public snapshot(): FlyflorConfig {
        return this.value;
    }
}
