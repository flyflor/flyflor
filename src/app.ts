import {
    RuntimeModule,
    promptApproveMcpToolCall,
    BlackboardModule,
    SocketModule,
    loadPromptTemplates,
    registerModelBackedBlackboardWorker,
    renderBlackboardWorkerSystemPrompt,
    SQLiteBlackboardStore,
    startHumanChat,
    WorkerManager,
} from "./agent/index.ts";
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
import { CompositeEventSink, ConsoleEventSink, EventsComponent, NullEventSink } from "./events/index.ts";
import { RuntimeModeComponent, ToolApprovalMode } from "./protocol/contracts/index.ts";
import { createModelClient, ModelComponent } from "./cognitive/mindstream/index.ts";
import { RuntimeMode, type EventSink, type ModelClient, type RuntimeMode as RuntimeModeType } from "./protocol/index.ts";
import { FileAuditSink, HttpAuditSink } from "./agent/sandbox/audit.sink.ts";
import { join } from "node:path";

export { BlackboardModule, DependencyContainer, SocketModule, MemoryModule, RuntimeModule, WorkerManager };

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
        SocketModule,
    ],
    exports: [
        ConfigComponent,
        EventsComponent,
        ModelComponent,
        WorkerManager,
        BlackboardModule,
        MemoryModule,
        RuntimeModule,
        SocketModule,
    ],
})
export class FlyFlorModule {}

export interface FlyFlorCreateOptions {
    argv?: string[];
    blackboard?: BlackboardModule;
    config?: FlyflorConfig;
    container?: DependencyContainer;
    events?: EventSink;
    /** Legacy injection alias for callers that still name the v1 wire surface gateway. */
    gateway?: SocketModule;
    memory?: MemoryModule;
    mode?: RuntimeModeType | string;
    model?: ModelClient;
    runtime?: RuntimeModule;
    socket?: SocketModule;
    workers?: WorkerManager;
}

export interface FlyFlorDependencies {
    blackboard: BlackboardModule;
    config: ConfigComponent;
    container: DependencyContainer;
    events: EventsComponent;
    eventDisposers: Array<() => void>;
    memory: MemoryModule;
    mode: RuntimeModeComponent;
    model: ModelComponent;
    runtime: RuntimeModule;
    socket: SocketModule;
    workers: WorkerManager;
}

export class FlyFlor {
    public constructor(private readonly dependencies: FlyFlorDependencies) {}

    public static async create(options: FlyFlorCreateOptions = {}): Promise<FlyFlor> {
        return createFlyFlorApplication(options);
    }

    public async start(): Promise<void> {
        if (this.dependencies.mode.is(RuntimeMode.Socket) || this.dependencies.mode.is(RuntimeMode.Gateway)) {
            this.dependencies.socket.start();
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
    const config = new ConfigComponent(applyCliRuntimeOverrides(options.config ?? (await loadConfig()), options.argv ?? process.argv));
    await loadPromptTemplates(config.paths);
    const events = new EventsComponent(options.events ?? createDefaultEventSink(mode.value, config.snapshot()));
    const model = new ModelComponent(options.model ?? createModelClient(config.model, events));
    const workers = options.workers ?? createDefaultWorkerManager(model.unwrap(), events);
    const blackboard =
        options.blackboard ?? new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
    const memory = options.memory ?? createMemory(config.snapshot(), events, model.unwrap());
    const runtime = options.runtime ?? new RuntimeModule(config.snapshot(), model.unwrap(), events, blackboard, memory);
    const socket = options.socket ?? options.gateway ?? new SocketModule(config.gateway, runtime, events, { paths: config.paths });
    const eventDisposers = registerRuntimeEventHandlers(config, events);
    const container = options.container ?? new DependencyContainer();

    return {
        blackboard,
        config,
        container,
        events,
        eventDisposers,
        memory,
        mode,
        model,
        runtime,
        socket,
        workers,
    };
}

function applyCliRuntimeOverrides(config: FlyflorConfig, argv: readonly string[]): FlyflorConfig {
    if (!argv.includes("--accept-hooks")) {
        return config;
    }
    return {
        ...config,
        sandbox: {
            ...config.sandbox,
            shellHookApproval: ToolApprovalMode.Allow,
        },
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
        [SocketModule, dependencies.socket],
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
    const primary = mode === RuntimeMode.Socket || mode === RuntimeMode.Gateway ? new ConsoleEventSink() : new NullEventSink();
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
