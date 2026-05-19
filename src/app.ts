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
import { AdaptersComponent } from "./agent/gateway/index.ts";
import { ConfigComponent, loadConfig, type FlyflorConfig } from "./config/index.ts";
import { RuntimeSkillUsageEventHandler } from "./agent/runtime/events/index.ts";
import { createMemory, MemoryModule } from "./cognitive/hippocampus/memory/index.ts";
import {
    assertModuleMetadata,
    DependencyContainer,
    isInjectionToken,
    Module,
    type DependencyToken,
} from "./agent/di/index.ts";
import { EventsComponent } from "./events/index.ts";
import { RuntimeModeComponent } from "./protocol/contracts/index.ts";
import { createModelClient, ModelComponent } from "./cognitive/mindstream/index.ts";
import {
    ConsoleEventSink,
    NullEventSink,
    RuntimeMode,
    type ChannelName,
    type EventSink,
    type ModelClient,
    type RuntimeMode as RuntimeModeType,
} from "./protocol/index.ts";
import { CompositeEventSink } from "./events/index.ts";
import { FileAuditSink, HttpAuditSink } from "./agent/sandbox/audit.sink.ts";
import { join } from "node:path";

export { BlackboardModule, DependencyContainer, GatewayModule, MemoryModule, RuntimeModule, WorkerManager };

@Module({
    providers: [
        DependencyContainer,
        RuntimeModeComponent,
        ConfigComponent,
        EventsComponent,
        ModelComponent,
        WorkerManager,
        BlackboardModule,
        MemoryModule,
        RuntimeModule,
        AdaptersComponent,
        GatewayModule,
    ],
    exports: [
        ConfigComponent,
        EventsComponent,
        ModelComponent,
        WorkerManager,
        BlackboardModule,
        MemoryModule,
        RuntimeModule,
        AdaptersComponent,
        GatewayModule,
    ],
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
    memory?: MemoryModule;
    mode?: RuntimeModeType | string;
    model?: ModelClient;
    runtime?: RuntimeModule;
    workers?: WorkerManager;
}

export interface FlyFlorDependencies {
    adapters: AdaptersComponent;
    blackboard: BlackboardModule;
    config: ConfigComponent;
    container: DependencyContainer;
    events: EventsComponent;
    eventDisposers: Array<() => void>;
    gateway: GatewayModule;
    memory: MemoryModule;
    mode: RuntimeModeComponent;
    model: ModelComponent;
    runtime: RuntimeModule;
    workers: WorkerManager;
}

export class FlyFlor {
    public constructor(private readonly dependencies: FlyFlorDependencies) {}

    public static async create(options: FlyFlorCreateOptions = {}): Promise<FlyFlor> {
        return createFlyFlorApplication(options);
    }

    public async start(): Promise<void> {
        if (this.dependencies.mode.is(RuntimeMode.Gateway)) {
            this.dependencies.gateway.start();
            return;
        }

        try {
            await startHumanChat(this.dependencies.runtime, {
                approveMcpToolCall: process.stdin.isTTY ? promptApproveMcpToolCall : undefined,
            });
        } finally {
            this.dispose();
        }
    }

    public dispose(): void {
        this.dependencies.runtime.dispose();
        for (const dispose of this.dependencies.eventDisposers.splice(0)) {
            dispose();
        }
    }

    public resolve<TValue>(token: DependencyToken<TValue>): TValue {
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
    const mode = new RuntimeModeComponent(normalizeRuntimeMode(options.mode ?? options.argv?.[2]));
    const config = new ConfigComponent(options.config ?? (await loadConfig()));
    await loadPromptTemplates(config.paths);
    const events = new EventsComponent(options.events ?? createDefaultEventSink(mode.value, config));
    const model = new ModelComponent(options.model ?? createModelClient(config.model, events));
    const workers = options.workers ?? createDefaultWorkerManager(model, events);
    const blackboard =
        options.blackboard ?? new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
    const memory = options.memory ?? createMemory(config, events, model);
    const runtime = options.runtime ?? new RuntimeModule(config, model, events, blackboard, memory);
    const eventDisposers = registerRuntimeEventHandlers(config, events);
    const adapters = new AdaptersComponent(options.adapters ?? createChannelAdapters(config.gateway));
    const gateway = options.gateway ?? new GatewayModule(config.gateway, adapters.asMap(), runtime, events, { paths: config.paths });
    const container = options.container ?? new DependencyContainer();

    return {
        adapters,
        blackboard,
        config,
        container,
        events,
        eventDisposers,
        gateway,
        memory,
        mode,
        model,
        runtime,
        workers,
    };
}

function registerRuntimeEventHandlers(config: ConfigComponent, events: EventsComponent): Array<() => void> {
    return [...events.registerHooks(new RuntimeSkillUsageEventHandler(config.snapshot()))];
}

function bindFlyFlorModuleProviders(container: DependencyContainer, dependencies: FlyFlorDependencies): void {
    const metadata = assertModuleMetadata(FlyFlorModule);
    const values = new Map<DependencyToken<unknown>, unknown>([
        [DependencyContainer, container],
        [RuntimeModeComponent, dependencies.mode],
        [ConfigComponent, dependencies.config],
        [EventsComponent, dependencies.events],
        [ModelComponent, dependencies.model],
        [WorkerManager, dependencies.workers],
        [BlackboardModule, dependencies.blackboard],
        [MemoryModule, dependencies.memory],
        [RuntimeModule, dependencies.runtime],
        [AdaptersComponent, dependencies.adapters],
        [GatewayModule, dependencies.gateway],
    ]);

    for (const provider of metadata.providers) {
        if (isInjectionToken(provider) || typeof provider === "function") {
            const value = values.get(provider);
            if (value === undefined) {
                throw new Error(`Missing FlyFlor module provider value: ${providerName(provider)}`);
            }
            container.bindSingleton(provider, value);
        }
    }
}

function providerName(provider: DependencyToken<unknown>): string {
    return isInjectionToken(provider) ? provider.name : provider.name;
}


function createDefaultEventSink(mode: RuntimeModeType, config: FlyflorConfig): EventSink {
    const logDir = config.paths.logDir;
    const configured = config.sandbox.auditSinks ?? [];
    const audits: EventSink[] = [];
    if (configured.length === 0) {
        audits.push(new FileAuditSink({ filePath: join(logDir, "audit.jsonl") }));
    } else {
        for (const entry of configured) {
            if (entry.kind === "file") {
                audits.push(new FileAuditSink({ filePath: entry.path ?? join(logDir, "audit.jsonl") }));
            } else if (entry.kind === "http") {
                audits.push(new HttpAuditSink({ url: entry.url, headers: entry.headers, timeoutMs: entry.timeoutMs }));
            }
        }
    }
    const primary = mode === RuntimeMode.Gateway ? new ConsoleEventSink() : new NullEventSink();
    return new CompositeEventSink([primary, ...audits]);
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
