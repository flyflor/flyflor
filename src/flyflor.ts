import { loadConfig, type FlyflorConfig } from "./config/index.ts";
import {
    AgentRuntime,
    BlackboardController,
    createChannelAdapters,
    GatewayServer,
    SQLiteBlackboardStore,
    startHumanChat,
    WorkerManager,
    type ChannelAdapter,
} from "./control/index.ts";
import { createBuiltinWorkers, createModelClient } from "./core/index.ts";
import {
    ConsoleEventSink,
    createInjectionToken,
    FlyFlor as FlyFlorComponent,
    FpcDependencyContainer,
    NullEventSink,
    RuntimeMode,
    type ChannelName,
    type EventSink,
    type InjectionToken,
    type ModelClient,
    type RuntimeMode as RuntimeModeType,
} from "./fpc/index.ts";

export const FlyFlorTokens = {
    Adapters: createInjectionToken<Map<ChannelName, ChannelAdapter>>("flyflor.adapters"),
    Blackboard: createInjectionToken<BlackboardController>("flyflor.blackboard"),
    Config: createInjectionToken<FlyflorConfig>("flyflor.config"),
    Container: createInjectionToken<FpcDependencyContainer>("flyflor.container"),
    Events: createInjectionToken<EventSink>("flyflor.events"),
    Gateway: createInjectionToken<GatewayServer>("flyflor.gateway"),
    Mode: createInjectionToken<RuntimeModeType>("flyflor.mode"),
    Model: createInjectionToken<ModelClient>("flyflor.model"),
    Runtime: createInjectionToken<AgentRuntime>("flyflor.runtime"),
    Workers: createInjectionToken<WorkerManager>("flyflor.workers"),
} as const;

export interface FlyFlorCreateOptions {
    adapters?: Map<ChannelName, ChannelAdapter>;
    argv?: string[];
    blackboard?: BlackboardController;
    config?: FlyflorConfig;
    container?: FpcDependencyContainer;
    events?: EventSink;
    gateway?: GatewayServer;
    mode?: RuntimeModeType | string;
    model?: ModelClient;
    runtime?: AgentRuntime;
    workers?: WorkerManager;
}

export interface FlyFlorDependencies {
    adapters: Map<ChannelName, ChannelAdapter>;
    blackboard: BlackboardController;
    config: FlyflorConfig;
    container: FpcDependencyContainer;
    events: EventSink;
    gateway: GatewayServer;
    mode: RuntimeModeType;
    model: ModelClient;
    runtime: AgentRuntime;
    workers: WorkerManager;
}

@FlyFlorComponent()
export class FlyFlor {
    constructor(private readonly dependencies: FlyFlorDependencies) {}

    static async create(options: FlyFlorCreateOptions = {}): Promise<FlyFlor> {
        const mode = normalizeRuntimeMode(options.mode ?? options.argv?.[2]);
        const config = options.config ?? (await loadConfig());
        const events = options.events ?? createDefaultEventSink(mode);
        const model = options.model ?? createModelClient(config.model);
        const workers = options.workers ?? createDefaultWorkerManager(events);
        const blackboard =
            options.blackboard ?? new BlackboardController(new SQLiteBlackboardStore(config.paths), events, workers);
        const runtime = options.runtime ?? new AgentRuntime(config, model, events, blackboard);
        const adapters = options.adapters ?? createChannelAdapters(config.gateway);
        const gateway = options.gateway ?? new GatewayServer(config.gateway, adapters, runtime, events);
        const container = options.container ?? new FpcDependencyContainer();

        container
            .bindSingleton(FlyFlorTokens.Container, container)
            .bindSingleton(FlyFlorTokens.Mode, mode)
            .bindSingleton(FlyFlorTokens.Config, config)
            .bindSingleton(FlyFlorTokens.Events, events)
            .bindSingleton(FlyFlorTokens.Blackboard, blackboard)
            .bindSingleton(FlyFlorTokens.Model, model)
            .bindSingleton(FlyFlorTokens.Runtime, runtime)
            .bindSingleton(FlyFlorTokens.Workers, workers)
            .bindSingleton(FlyFlorTokens.Adapters, adapters)
            .bindSingleton(FlyFlorTokens.Gateway, gateway);

        return new FlyFlor({
            adapters,
            blackboard,
            config,
            container,
            events,
            gateway,
            mode,
            model,
            runtime,
            workers,
        });
    }

    async start(): Promise<void> {
        if (this.dependencies.mode === RuntimeMode.Gateway) {
            this.dependencies.gateway.start();
            return;
        }

        await startHumanChat(this.dependencies.runtime);
    }

    resolve<TValue>(token: InjectionToken<TValue>): TValue {
        return this.dependencies.container.resolve(token);
    }
}

let singleton: Promise<FlyFlor> | undefined;

export function getFlyFlor(options: FlyFlorCreateOptions = {}): Promise<FlyFlor> {
    singleton ??= FlyFlor.create(options);
    return singleton;
}

function createDefaultEventSink(mode: RuntimeModeType): EventSink {
    return mode === RuntimeMode.Gateway ? new ConsoleEventSink() : new NullEventSink();
}

function createDefaultWorkerManager(events: EventSink): WorkerManager {
    const manager = new WorkerManager(events);
    for (const worker of createBuiltinWorkers()) {
        manager.register(worker);
    }
    return manager;
}

function normalizeRuntimeMode(mode: RuntimeModeType | string | undefined): RuntimeModeType {
    if (!mode) {
        return RuntimeMode.Chat;
    }
    if (mode === RuntimeMode.Chat || mode === RuntimeMode.Gateway) {
        return mode;
    }
    throw new Error(`Unsupported runtime mode: ${mode}`);
}
