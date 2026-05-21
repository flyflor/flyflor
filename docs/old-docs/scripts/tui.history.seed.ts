import { join } from "node:path";

import { loadConfig } from "../src/config/index.ts";
import { BrainStore } from "../src/fch/hippocampus/memory/brain/store.ts";
import { Channel, ChatType, MemoryEventType } from "../src/protocol/contracts/index.ts";

interface SeedOptions {
    count: number;
    spacingMs: number;
    actorKey: string;
}

async function main(): Promise<void> {
    const options = parseArgs(Bun.argv.slice(2));
    const config = await loadConfig();
    const brain = new BrainStore({ dbPath: join(config.paths.home, "brain.db") });
    await brain.open();
    try {
        const baseTs = Date.now() - options.count * options.spacingMs - 60_000;
        for (let i = 0; i < options.count; i += 1) {
            const ts = baseTs + i * options.spacingMs;
            const eventId = `tui-history-${String(i + 1).padStart(6, "0")}`;
            brain.appendEvent({
                id: eventId,
                ts,
                actorKey: options.actorKey,
                ingressSurface: Channel.Stdio,
                type: MemoryEventType.Event,
                content: {
                    assistantText: buildAssistantText(i),
                    seed: "tui-history",
                    userText: buildUserText(i),
                },
                importance: 0.2,
            });
        }
        process.stdout.write(
            `Seeded ${options.count} fake history turns for ${options.actorKey} at ${config.paths.home}/brain.db\n`,
        );
    } finally {
        brain.close();
    }
}

function parseArgs(argv: string[]): SeedOptions {
    const count = parseInteger(flagValue(argv, "--count"), 1000, 1);
    const spacingMs = parseInteger(flagValue(argv, "--spacing-ms"), 15_000, 1_000);
    const actorKey = flagValue(argv, "--user") ?? "human";
    return { count, spacingMs, actorKey };
}

function flagValue(argv: string[], flag: string): string | undefined {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    return argv[index + 1];
}

function parseInteger(value: string | undefined, fallback: number, min: number): number {
    const parsed = value ? Number.parseInt(value, 10) : fallback;
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.floor(parsed));
}

function buildUserText(index: number): string {
    const topic = HISTORY_TOPICS[index % HISTORY_TOPICS.length] ?? "general";
    return `History seed ${index + 1}: ${topic} check-in`;
}

function buildAssistantText(index: number): string {
    const variant = index % 3;
    if (variant === 0) {
        return [
            `### ${HISTORY_TOPICS[index % HISTORY_TOPICS.length] ?? "note"}`,
            "",
            `- checkpoint ${index + 1}`,
            `- status: steady`,
            `- focus: \`scroll\``,
        ].join("\n");
    }
    if (variant === 1) {
        return [
            "```ts",
            `const turn = ${index + 1};`,
            `console.log("history", turn);`,
            "```",
            "",
            `This entry keeps the scroll path warm for batch ${Math.floor(index / 10) + 1}.`,
        ].join("\n");
    }
    return [
        `Plain response ${index + 1}.`,
        "",
        `This line is here to produce a long, selectable transcript row for performance testing.`,
    ].join("\n");
}

const HISTORY_TOPICS = [
    "planning",
    "debugging",
    "copy flow",
    "markdown render",
    "history pagination",
    "blackboard view",
];

await main().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`);
    process.exit(1);
});
