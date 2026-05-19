/**
 * Interactive TUI guard.
 *
 * Full-screen OpenTUI renderers require both stdin and stdout to be TTYs.
 * CI, pipes and redirected commands should fail fast instead of creating a
 * renderer that waits forever for terminal capabilities or key events.
 */
export interface TtyLike {
    isTTY?: boolean;
}

export function canStartInteractiveTui(input: TtyLike = process.stdin, output: TtyLike = process.stdout): boolean {
    return input.isTTY === true && output.isTTY === true;
}

export function interactiveTuiUnavailableMessage(command: string): string {
    return `${command} requires an interactive TTY on stdin and stdout. Use a non-TUI command or run it from a terminal.`;
}
