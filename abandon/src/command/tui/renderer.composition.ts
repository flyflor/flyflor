import type { CliRendererConfig } from "@opentui/core";

type TuiRendererConfig = CliRendererConfig & {
    enableMouseMovement?: boolean;
    useMouse: boolean;
};

/**
 * Terminal-safe OpenTUI renderer defaults shared by every Flyflor TUI surface.
 *
 * OpenTUI currently defaults `enableMouseMovement` to true whenever mouse mode is
 * enabled. That asks terminals for all-motion reports, which is noisy enough in
 * iTerm2/Bash to overflow parser recursion during normal pointer movement.
 */
export function useTuiRendererConfig<TConfig extends CliRendererConfig>(config: TConfig): TConfig & TuiRendererConfig {
    const mouseEnabled = config.useMouse ?? true;
    return {
        ...config,
        enableMouseMovement: mouseEnabled ? false : config.enableMouseMovement,
        useMouse: mouseEnabled,
        useKittyKeyboard: config.useKittyKeyboard ?? null,
    };
}
