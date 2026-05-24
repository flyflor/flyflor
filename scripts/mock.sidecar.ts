#!/usr/bin/env bun

/**
 * Deterministic process-json sidecar used by tests and local descriptor demos.
 * It intentionally performs no real browser, screen, audio, web, LSP or task
 * action; production sidecars live outside the Bun kernel binary.
 */
export async function runMockSidecar(): Promise<void> {
    const raw = await new Response(Bun.stdin.stream()).text();
    const request = raw.trim().length > 0 ? JSON.parse(raw) : {};

    process.stdout.write(JSON.stringify({
        ok: true,
        mock: true,
        request,
    }) + "\n");
}

if (import.meta.main) {
    await runMockSidecar();
}
