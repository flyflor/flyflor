import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigForPaths, type FlyflorPaths } from "../src/config/index.ts";
import { RuntimeModule, BlackboardModule, SQLiteBlackboardStore, WorkerManager } from "../src/agent/index.ts";
import {
    BlackboardMode,
    BlackboardWorkerOutcome,
    Channel,
    ChatType,
    type EventSink,
    type GatewayMessage,
    type ModelClient,
    type ModelMessage,
    type RuntimeEvent,
} from "../src/agent/di/index.ts";
import { Worker } from "../src/agent/di/index.ts";

async function main(): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-blackboard-routing-stress-"));
    try {
        const paths = stressPaths(root);
        const config = await loadConfigForPaths(paths);
        const runtimeConfig = {
            ...config,
            memory: {
                ...config.memory,
                qdrant: { ...config.memory.qdrant, enabled: false },
                crystal: { ...config.memory.crystal, surreal: { ...config.memory.crystal.surreal, enabled: false } },
            },
        };
        const cases = stressCases();
        const events = new CapturingStressSink();
        const workers = new WorkerManager(events);
        workers.register(new StressFinalWorker());
        const model = new StressModel(cases);
        const blackboard = new BlackboardModule(new SQLiteBlackboardStore(paths), events, workers);
        const runtime = new RuntimeModule(runtimeConfig, model, events, blackboard);

        const started = performance.now();
        const results = [];
        for (const item of cases) {
            const turnStarted = performance.now();
            const reply = await runtime.handleMessage(messageFor(item.request), {
                now: "2026-05-10T00:00:00.000Z",
                requestId: crypto.randomUUID(),
            });
            const metadata = reply.metadata?.blackboard as { mode?: string } | undefined;
            results.push({
                expected: item.expectedMode,
                elapsedMs: Number((performance.now() - turnStarted).toFixed(3)),
                mode: metadata?.mode,
                request: item.request,
            });
        }

        const elapsedMs = Number((performance.now() - started).toFixed(3));
        const hits = results.filter((item) => item.mode === item.expected).length;
        const garbageCases = cases.filter((item) => item.kind === "garbage").length;
        const garbageInterference = results.filter(
            (item) => item.expected === BlackboardMode.Direct && item.mode !== item.expected,
        ).length;
        const latencies = results.map((item) => item.elapsedMs).sort((left, right) => left - right);
        console.log(
            JSON.stringify(
                {
                    cases: cases.length,
                    elapsedMs,
                    garbageCases,
                    garbageInterference,
                    hitRate: Number((hits / cases.length).toFixed(4)),
                    latency: {
                        avgMs: Number(
                            (results.reduce((sum, item) => sum + item.elapsedMs, 0) / results.length).toFixed(3),
                        ),
                        p95Ms: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
                    },
                    modes: countBy(results.map((item) => String(item.mode))),
                    modelCalls: model.calls,
                },
                null,
                2,
            ),
        );
    } finally {
        await rm(root, { force: true, recursive: true });
    }
}

interface StressCase {
    expectedMode: BlackboardMode;
    kind: "normal" | "complex" | "garbage";
    request: string;
}

class StressModel implements ModelClient {
    calls = 0;

    constructor(private readonly cases: StressCase[]) {}

    async generate(messages: ModelMessage[]): Promise<string> {
        this.calls += 1;
        const system = messages.find((message) => message.role === "system")?.content ?? "";
        const user = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
        if (system.includes("Return only one JSON object") && system.includes('"mode"')) {
            const item = this.cases.find((candidate) => candidate.request === user);
            if (!item) {
                throw new Error(`Missing stress route fixture for request: ${user}`);
            }
            return JSON.stringify({
                mode: item.expectedMode,
                score:
                    item.expectedMode === BlackboardMode.Blackboard
                        ? 0.82
                        : item.expectedMode === BlackboardMode.DirectWithWatch
                          ? 0.45
                          : 0.12,
                reason: `stress-${item.expectedMode}`,
                signals: [`stress-${item.kind}`],
                needsReflectionCandidate: item.expectedMode === BlackboardMode.Blackboard,
                workers:
                    item.expectedMode === BlackboardMode.Blackboard
                        ? [{ role: "stress-final-worker", name: "Stress final worker", stage: "summary" }]
                        : [],
            });
        }
        if (system.includes("Extract only reusable method knowledge")) {
            return "[]";
        }
        return "stress final answer";
    }
}

@Worker("stress-final-worker")
class StressFinalWorker {
    run(input: { goal: string; prompt?: string }) {
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: "stress worker final",
            agreement: true,
            outcome: BlackboardWorkerOutcome.Final,
            newFacts: ["stress worker completed"],
            openIssues: [],
            blockers: [],
            risk: "low",
            discussion: [{ role: "worker", content: "stress worker completed", visibility: "public" }],
        };
    }
}

function stressCases(): StressCase[] {
    const seeds: StressCase[] = [
        { expectedMode: BlackboardMode.Direct, kind: "normal", request: "Say hello in one sentence." },
        {
            expectedMode: BlackboardMode.DirectWithWatch,
            kind: "normal",
            request: "Sketch a small plan and watch for gaps.",
        },
        {
            expectedMode: BlackboardMode.Blackboard,
            kind: "complex",
            request: "Implement the runtime change, review it, and verify it across tests.",
        },
        {
            expectedMode: BlackboardMode.Blackboard,
            kind: "complex",
            request:
                "This cannot be answered from the current context; discuss blockers and return numbered questions.",
        },
        { expectedMode: BlackboardMode.Direct, kind: "garbage", request: "asdf ".repeat(40).trim() },
    ];
    return Array.from({ length: 80 }, (_, index) => ({
        ...seeds[index % seeds.length]!,
        request: `${seeds[index % seeds.length]!.request} #${index}`,
    }));
}

function messageFor(text: string): GatewayMessage {
    return {
        id: crypto.randomUUID(),
        raw: {},
        receivedAt: "2026-05-10T00:00:00.000Z",
        route: {
            channel: Channel.Stdio,
            chatId: "stress",
            chatType: ChatType.Direct,
        },
        text,
        user: {
            id: "stress-user",
        },
    };
}

function stressPaths(root: string): FlyflorPaths {
    return {
        cacheDir: join(root, "cache"),
        configDir: join(root, "config"),
        home: root,
        logDir: join(root, "logs"),
        mcpDir: join(root, "mcp"),
        memoryDir: join(root, "memory"),
        pluginDir: join(root, "plugins"),
        promptDir: join(import.meta.dir, "..", "templates", "prompts"),
        skillDir: join(root, "skills"),
        storageDir: join(root, "storage"),
        templateDir: join(import.meta.dir, "..", "templates"),
        workspaceDir: join(root, "workspace"),
    };
}

function countBy(values: string[]): Record<string, number> {
    return values.reduce<Record<string, number>>((counts, value) => {
        counts[value] = (counts[value] ?? 0) + 1;
        return counts;
    }, {});
}

class CapturingStressSink implements EventSink {
    readonly events: RuntimeEvent[] = [];

    publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
}

await main();
