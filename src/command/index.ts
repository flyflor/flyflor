import { RuntimeMode, type RuntimeMode as RuntimeModeType } from "../protocol/contracts/index.ts";
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
