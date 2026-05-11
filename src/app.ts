import {
    RuntimeModule,
    promptApproveMcpToolCall,
    BlackboardModule,
    createChannelAdapters,
    GatewayModule,
    loadPromptTemplates,
    registerModelBackedBlackboardWorker,
    renderBlackboardWorkerSystemPrompt,
    SQLiteBlackboardStore,
    startHumanChat,
    WorkerManager,
    type ChannelAdapter,
} from "./agent/index.ts";
import { loadConfig, type FlyflorConfig } from "./config/index.ts";
import {
    assertModuleMetadata,
    createInjectionToken,
    DependencyContainer,
    Module,
    type InjectionToken,
} from "./agent/di/index.ts";
import { createModelClient } from "./llm/index.ts";
import {
    ConsoleEventSink,
    NullEventSink,
    RuntimeMode,
    type ChannelName,
    type EventSink,
    type ModelClient,
    type RuntimeMode as RuntimeModeType,
} from "./protocol/index.ts";

export const FlyFlorTokens = {
    Adapters: createInjectionToken<Map<ChannelName, ChannelAdapter>>("flyflor.adapters"),
    Blackboard: createInjectionToken<BlackboardModule>("flyflor.blackboard"),
    Config: createInjectionToken<FlyflorConfig>("flyflor.config"),
    Container: createInjectionToken<DependencyContainer>("flyflor.container"),
    Events: createInjectionToken<EventSink>("flyflor.events"),
    Gateway: createInjectionToken<GatewayModule>("flyflor.gateway"),
    Mode: createInjectionToken<RuntimeModeType>("flyflor.mode"),
    Model: createInjectionToken<ModelClient>("flyflor.model"),
    Runtime: createInjectionToken<RuntimeModule>("flyflor.runtime"),
    Workers: createInjectionToken<WorkerManager>("flyflor.workers"),
} as const;

@Module({
    name: "flyflor",
    providers: [
        FlyFlorTokens.Container,
        FlyFlorTokens.Mode,
        FlyFlorTokens.Config,
        FlyFlorTokens.Events,
        FlyFlorTokens.Model,
        FlyFlorTokens.Workers,
        FlyFlorTokens.Blackboard,
        FlyFlorTokens.Runtime,
        FlyFlorTokens.Adapters,
        FlyFlorTokens.Gateway,
    ],
    exports: [
        FlyFlorTokens.Config,
        FlyFlorTokens.Events,
        FlyFlorTokens.Model,
        FlyFlorTokens.Workers,
        FlyFlorTokens.Blackboard,
        FlyFlorTokens.Runtime,
        FlyFlorTokens.Adapters,
        FlyFlorTokens.Gateway,
    ],
    tags: ["app", "root"],
})
export class FlyFlorModule {}

export interface FlyFlorCreateOptions {
    adapters?: Map<ChannelName, ChannelAdapter>;
    argv?: string[];
    blackboard?: BlackboardModule;
    config?: FlyflorConfig;
    container?: DependencyContainer;
    events?: EventSink;
    gateway?: GatewayModule;
    mode?: RuntimeModeType | string;
    model?: ModelClient;
    runtime?: RuntimeModule;
    workers?: WorkerManager;
}

export interface FlyFlorDependencies {
    adapters: Map<ChannelName, ChannelAdapter>;
    blackboard: BlackboardModule;
    config: FlyflorConfig;
    container: DependencyContainer;
    events: EventSink;
    gateway: GatewayModule;
    mode: RuntimeModeType;
    model: ModelClient;
    runtime: RuntimeModule;
    workers: WorkerManager;
}

export class FlyFlor {
    constructor(private readonly dependencies: FlyFlorDependencies) {}

    static async create(options: FlyFlorCreateOptions = {}): Promise<FlyFlor> {
        return createFlyFlorApplication(options);
    }

    async start(): Promise<void> {
        if (this.dependencies.mode === RuntimeMode.Gateway) {
            this.dependencies.gateway.start();
            return;
        }

        await startHumanChat(this.dependencies.runtime, {
            approveMcpToolCall: process.stdin.isTTY ? promptApproveMcpToolCall : undefined,
        });
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

async function createFlyFlorApplication(options: FlyFlorCreateOptions): Promise<FlyFlor> {
    const dependencies = await createFlyFlorDependencies(options);
    bindFlyFlorModuleProviders(dependencies.container, dependencies);
    return new FlyFlor(dependencies);
}

async function createFlyFlorDependencies(options: FlyFlorCreateOptions): Promise<FlyFlorDependencies> {
    const mode = normalizeRuntimeMode(options.mode ?? options.argv?.[2]);
    const config = options.config ?? (await loadConfig());
    await loadPromptTemplates(config.paths);
    const events = options.events ?? createDefaultEventSink(mode);
    const model = options.model ?? createModelClient(config.model);
    const workers = options.workers ?? createDefaultWorkerManager(model, events);
    const blackboard =
        options.blackboard ?? new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
    const runtime = options.runtime ?? new RuntimeModule(config, model, events, blackboard);
    const adapters = options.adapters ?? createChannelAdapters(config.gateway);
    const gateway = options.gateway ?? new GatewayModule(config.gateway, adapters, runtime, events);
    const container = options.container ?? new DependencyContainer();

    return {
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
    };
}

function bindFlyFlorModuleProviders(container: DependencyContainer, dependencies: FlyFlorDependencies): void {
    const metadata = assertModuleMetadata(FlyFlorModule);
    const values = new Map<InjectionToken<unknown>, unknown>([
        [FlyFlorTokens.Container, container],
        [FlyFlorTokens.Mode, dependencies.mode],
        [FlyFlorTokens.Config, dependencies.config],
        [FlyFlorTokens.Events, dependencies.events],
        [FlyFlorTokens.Model, dependencies.model],
        [FlyFlorTokens.Workers, dependencies.workers],
        [FlyFlorTokens.Blackboard, dependencies.blackboard],
        [FlyFlorTokens.Runtime, dependencies.runtime],
        [FlyFlorTokens.Adapters, dependencies.adapters],
        [FlyFlorTokens.Gateway, dependencies.gateway],
    ]);

    for (const provider of metadata.providers) {
        if (isInjectionToken(provider)) {
            const value = values.get(provider);
            if (value === undefined) {
                throw new Error(`Missing FlyFlor module provider value: ${provider.name}`);
            }
            container.bindSingleton(provider, value);
        }
    }
}

function isInjectionToken(value: unknown): value is InjectionToken<unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        "key" in value &&
        "name" in value &&
        typeof (value as { key?: unknown }).key === "symbol" &&
        typeof (value as { name?: unknown }).name === "string"
    );
}

function createDefaultEventSink(mode: RuntimeModeType): EventSink {
    return mode === RuntimeMode.Gateway ? new ConsoleEventSink() : new NullEventSink();
}

function createDefaultWorkerManager(model: ModelClient, events: EventSink): WorkerManager {
    const manager = new WorkerManager(events);
    registerModelBackedBlackboardWorker(manager, model, {
        systemPrompt: (participant) => renderBlackboardWorkerSystemPrompt({ participant }),
    });
    return manager;
}

function normalizeRuntimeMode(mode: RuntimeModeType | string | undefined): RuntimeModeType {
    if (!mode) {
        return RuntimeMode.Chat;
    }
    if (Object.values(RuntimeMode).includes(mode as RuntimeModeType)) {
        return mode as RuntimeModeType;
    }
    throw new Error(`Unsupported runtime mode: ${mode}`);
}
