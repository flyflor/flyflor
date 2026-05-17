import { clearEnvCache, type CliRenderer } from "@opentui/core";

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
    // OpenTUI normally emits these through the native renderer. The explicit
    // fallback keeps Docker exec / terminal scrollback from stealing wheel
    // events before the ScrollBox sees them.
    stdout.write("\x1b[?1049h\x1b[H\x1b[2J\x1b[3J\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h");
    return () => {
        stdout.write("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1049l");
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
