import { describe, expect, spyOn, test } from "bun:test";
import { runFlyflorUtilityCommand } from "../src/command/cli/commands.ts";
import { runFlyflorCommand } from "../src/command/index.ts";
import { canStartInteractiveTui, interactiveTuiUnavailableMessage } from "../src/command/tui/tty.ts";

describe("TUI TTY guard", () => {
    test("requires both stdin and stdout to be TTYs", () => {
        expect(canStartInteractiveTui({ isTTY: true }, { isTTY: true })).toBe(true);
        expect(canStartInteractiveTui({ isTTY: false }, { isTTY: true })).toBe(false);
        expect(canStartInteractiveTui({ isTTY: true }, { isTTY: false })).toBe(false);
        expect(canStartInteractiveTui({}, { isTTY: true })).toBe(false);
    });

    test("explicit tui mode fails fast in non-interactive environments", async () => {
        const error = spyOn(console, "error").mockImplementation(() => {});

        const result = await runFlyflorCommand(["bun", "flyflor", "tui"]);

        expect(result.exitCode).toBe(2);
        expect(error).toHaveBeenCalledWith(interactiveTuiUnavailableMessage("flyflor tui"));
        error.mockRestore();
    });

    test("global --tui also fails fast before constructing the app", async () => {
        const error = spyOn(console, "error").mockImplementation(() => {});

        const result = await runFlyflorCommand(["bun", "flyflor", "--tui"]);

        expect(result.exitCode).toBe(2);
        expect(error).toHaveBeenCalledWith(interactiveTuiUnavailableMessage("flyflor --tui"));
        error.mockRestore();
    });

    test("top-level chat --tui reports the chat-specific TTY gate", async () => {
        const error = spyOn(console, "error").mockImplementation(() => {});

        const result = await runFlyflorCommand(["bun", "flyflor", "chat", "--tui"]);

        expect(result.exitCode).toBe(2);
        expect(error).toHaveBeenCalledWith(interactiveTuiUnavailableMessage("flyflor chat --tui"));
        error.mockRestore();
    });

    test("chat --tui utility command returns the TTY-gate exit code", async () => {
        const error = spyOn(console, "error").mockImplementation(() => {});

        const result = await runFlyflorUtilityCommand(["bun", "flyflor", "chat", "--tui"]);

        expect(result?.exitCode).toBe(2);
        expect(error).toHaveBeenCalledWith(interactiveTuiUnavailableMessage("flyflor chat --tui"));
        error.mockRestore();
    });
});
