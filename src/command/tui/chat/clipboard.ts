export function copyTextToTerminalClipboard(text: string): void {
    if (process.platform === "darwin") {
        const result = Bun.spawnSync(["/usr/bin/pbcopy"], {
            stdin: new Response(text),
            stdout: "ignore",
            stderr: "pipe",
        });
        if (!result.success) {
            const stderr = result.stderr.toString().trim();
            throw new Error(stderr || `pbcopy failed with exit code ${result.exitCode}`);
        }
        return;
    }
    if (!process.stdout.isTTY) {
        throw new Error("Cannot copy selection: stdout is not a TTY");
    }
    process.stdout.write(osc52ClipboardSequence(text));
}

export function osc52ClipboardSequence(text: string): string {
    const payload = Buffer.from(text).toString("base64");
    const sequence = `\x1b]52;c;${payload}\x07`;
    if (process.env.TMUX || process.env.STY) {
        return `\x1bPtmux;\x1b${sequence}\x1b\\`;
    }
    return sequence;
}
