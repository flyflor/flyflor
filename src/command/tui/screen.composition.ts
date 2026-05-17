import { clearEnvCache, type CliRenderer } from "@opentui/core";

type TuiEnv = typeof process.env;

/**
 * OpenTUI lets OTUI_USE_ALTERNATE_SCREEN override the explicit renderer
 * config. Flyflor TUI surfaces must stay off the terminal scrollback buffer,
 * otherwise the terminal's native scrollbar can overlap the in-app scroll
 * model even when ScrollBox visual bars are detached.
 */
export async function withPinnedAlternateScreen<TValue>(
    createRenderer: () => Promise<TValue>,
    clearCache: () => void = clearEnvCache,
): Promise<TValue> {
    const previousAlternateScreen = process.env.OTUI_USE_ALTERNATE_SCREEN;
    const restoreTerminalEnv = useTuiTerminalEnvironment();
    process.env.OTUI_USE_ALTERNATE_SCREEN = "1";
    clearOpenTuiEnvCache(clearCache);
    try {
        return await createRenderer();
    } finally {
        if (previousAlternateScreen === undefined) {
            delete process.env.OTUI_USE_ALTERNATE_SCREEN;
        } else {
            process.env.OTUI_USE_ALTERNATE_SCREEN = previousAlternateScreen;
        }
        restoreTerminalEnv();
        clearOpenTuiEnvCache(clearCache);
    }
}

export function pinRendererAlternateScreen(renderer: CliRenderer): void {
    if (renderer.screenMode !== "alternate-screen") {
        renderer.screenMode = "alternate-screen";
    }
}

export function pinTerminalMouseScreen(stdout: NodeJS.WriteStream = process.stdout): () => void {
    if (!stdout.isTTY) return () => {};
    // Only pin the alternate screen here. Mouse tracking is owned by OpenTUI's
    // renderer; duplicating all-motion tracking floods iTerm2/Bash stdin and can
    // trigger parser recursion failures.
    stdout.write("\x1b[?1049h\x1b[H\x1b[2J\x1b[3J");
    return () => {
        stdout.write("\x1b[?1049l");
    };
}

export function useTuiTerminalEnvironment(env: TuiEnv = process.env): () => void {
    const previousColorTerm = env.COLORTERM;
    if (shouldPreferTrueColor(env)) {
        env.COLORTERM = "truecolor";
    }
    return () => {
        if (previousColorTerm === undefined) {
            delete env.COLORTERM;
        } else {
            env.COLORTERM = previousColorTerm;
        }
    };
}

export function clearOpenTuiEnvCache(clearCache: () => void = clearEnvCache): void {
    try {
        clearCache();
    } catch (cause) {
        // OpenTUI 0.2.x can leave its env singleton undefined inside Bun's
        // Linux compiled bundle. Cache clearing is best-effort; the env value
        // is still set before renderer creation in the same turn.
        if (isOpenTuiCompiledEnvCacheMiss(cause)) return;
        throw cause;
    }
}

function isOpenTuiCompiledEnvCacheMiss(cause: unknown): boolean {
    if (!(cause instanceof TypeError)) return false;
    const message = cause.message;
    return (
        (message.includes("undefined is not an object") || message.includes("Cannot read properties of undefined")) &&
        message.includes("clearCache")
    );
}

function shouldPreferTrueColor(env: TuiEnv): boolean {
    if (env.NO_COLOR !== undefined || env.COLORTERM !== undefined) return false;
    if (env.TERM_PROGRAM === "iTerm.app" || env.TERM_PROGRAM === "Apple_Terminal") return true;
    const term = env.TERM ?? "";
    return term.includes("24bit") || term.includes("truecolor");
}
