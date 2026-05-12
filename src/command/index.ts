import { RuntimeMode, type RuntimeMode as RuntimeModeType } from "../protocol/contracts/index.ts";
import { RuntimeEventBus } from "../protocol/events/index.ts";
import {
    isFlyflorUtilityCommand,
    parseFlyflorCommand,
    runFlyflorUtilityCommand,
    type FlyflorCommandResult,
} from "./cli/commands.ts";

export async function runFlyflorCommand(argv: string[]): Promise<FlyflorCommandResult> {
    if (isHelpRequest(argv)) {
        return { exitCode: parseFlyflorCommand(argv) ?? 0 };
    }

    const oneshot = optionValue(argv, "-z", "--oneshot");
    if (oneshot && oneshot.trim().length > 0) {
        return (
            (await runFlyflorUtilityCommand(rootChatArgs(argv, oneshot))) ?? {
                exitCode: 1,
            }
        );
    }

    if (argv.includes("--tui")) {
        return runFlyflorCommand([argv[0] ?? "flyflor", argv[1] ?? "flyflor", RuntimeMode.Tui]);
    }

    const commandResult = await runFlyflorUtilityCommand(argv);
    if (commandResult) {
        return commandResult;
    }

    const parsed = parseFlyflorMode(argv);
    if (typeof parsed === "number") {
        return { exitCode: parsed };
    }

    if (parsed === RuntimeMode.Tui) {
        const { getFlyFlor } = await import("../app.ts");
        const app = await getFlyFlor({ argv, mode: parsed });
        const { startTui } = await import("./tui/index.tsx");
        await startTui(app);
        return { exitCode: 0 };
    }

    const { getFlyFlor } = await import("../app.ts");
    const app = await getFlyFlor({ argv, mode: parsed });

    if (parsed === RuntimeMode.Chat && process.stdin.isTTY) {
        const { startChatTui } = await import("./tui/chat.tui.tsx");
        const { FlyFlorTokens } = await import("../app.ts");
        const runtime = app.resolve(FlyFlorTokens.Runtime);
        const events = app.resolve(FlyFlorTokens.Events);
        startChatTui(runtime, {
            eventBus: events instanceof RuntimeEventBus ? events : undefined,
            agentName: "flyflor",
        });
        return { exitCode: 0 };
    }

    await app.start();
    return { exitCode: 0 };
}

export function parseFlyflorMode(argv: string[]): RuntimeModeType | number {
    if (!argv[2]) {
        return RuntimeMode.Chat;
    }
    const mode = String(argv[2]);
    if (isRuntimeMode(mode)) {
        return mode;
    }
    if (isFlyflorUtilityCommand(mode)) {
        const exitCode = parseFlyflorCommand(argv);
        return exitCode ?? 0;
    }
    console.error(`Unsupported runtime mode or command: ${mode}`);
    return 1;
}

function isRuntimeMode(value: string): value is RuntimeModeType {
    return value === RuntimeMode.Chat || value === RuntimeMode.Gateway || value === RuntimeMode.Tui;
}

function isHelpRequest(argv: string[]): boolean {
    const command = argv[2];
    if (command === "-h" || command === "--help") {
        return true;
    }
    if (!command) {
        return argv.includes("-h") || argv.includes("--help");
    }
    return isFlyflorUtilityCommand(command) && (argv.includes("-h") || argv.includes("--help"));
}

function optionValue(argv: string[], shortFlag: string, longFlag: string): string | undefined {
    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === shortFlag || value === longFlag) {
            const next = argv[index + 1];
            return next && !next.startsWith("-") ? next : undefined;
        }
        if (value?.startsWith(`${longFlag}=`)) {
            return value.slice(longFlag.length + 1);
        }
    }
    return undefined;
}

function rootChatArgs(argv: string[], query: string): string[] {
    const args = [argv[0] ?? "flyflor", argv[1] ?? "flyflor", "chat", "--query", query];
    appendOption(args, "--model", optionValue(argv, "-m", "--model"));
    appendOption(args, "--provider", optionValue(argv, "", "--provider"));
    if (argv.includes("--accept-hooks")) {
        args.push("--accept-hooks");
    }
    const skills = optionValues(argv, "-s", "--skills");
    if (skills.length > 0) {
        args.push("--skills", ...skills);
    }
    return args;
}

function appendOption(args: string[], flag: string, value: string | undefined): void {
    if (value && value.trim().length > 0) {
        args.push(flag, value);
    }
}

function optionValues(argv: string[], shortFlag: string, longFlag: string): string[] {
    const values: string[] = [];
    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === shortFlag || value === longFlag) {
            for (let next = index + 1; next < argv.length; next += 1) {
                const candidate = argv[next];
                if (!candidate || candidate.startsWith("-")) break;
                values.push(candidate);
            }
        }
    }
    return values;
}
