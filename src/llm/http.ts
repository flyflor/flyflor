import type { ModelConfig } from "../config/index.ts";

export function normalizeOpenAIBaseUrl(value: string): string {
    const raw = value.trim().replace(/\/+$/, "");
    if (!raw) {
        return raw;
    }
    return raw.endsWith("/v1") ? raw.slice(0, -3) : raw;
}

export function normalizeAnthropicBaseUrl(value: string): string {
    const raw = value.trim().replace(/\/+$/, "");
    return raw.endsWith("/v1") ? raw.slice(0, -3) : raw;
}

export async function fetchModelEndpoint(
    config: ModelConfig,
    path: string,
    init: RequestInit,
    normalizeBaseUrl: (value: string) => string,
    options: { signal?: AbortSignal } = {},
): Promise<Response> {
    const url = new URL(path, normalizeBaseUrl(config.baseUrl));
    const signal = timeoutSignal(config.timeoutMs, options.signal);
    try {
        return await fetch(url, {
            ...init,
            signal,
        });
    } catch (error) {
        throw annotateModelFetchError(error, config, url);
    }
}

function timeoutSignal(timeoutMs: number, parent?: AbortSignal): AbortSignal {
    if (!parent) {
        return AbortSignal.timeout(timeoutMs);
    }
    if (parent.aborted) {
        return parent;
    }
    return AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);
}

function annotateModelFetchError(error: unknown, config: ModelConfig, url: URL): Error {
    if (!(error instanceof Error)) {
        return new Error(String(error));
    }
    // Preserve Error.name so TUI callers still show TimeoutError, while adding the request boundary.
    const detail = `provider=${config.providerId} model=${config.model} url=${redactUrl(url)} timeoutMs=${config.timeoutMs}`;
    const next = new Error(`${error.message} (${detail})`);
    next.name = error.name;
    next.cause = error;
    return next;
}

function redactUrl(url: URL): string {
    const next = new URL(url);
    next.username = "";
    next.password = "";
    return next.toString();
}

export async function assertStreamResponse(response: Response): Promise<void> {
    if (response.ok) {
        return;
    }
    const payload = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
    throw new Error(payload?.error?.message ?? `Model stream request failed: ${response.status}`);
}

export async function* readSseJson<TValue>(response: Response): AsyncGenerator<TValue> {
    if (!response.body) {
        throw new Error("Model stream response has no body");
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    try {
        while (true) {
            const read = await reader.read();
            if (read.done) {
                break;
            }
            buffer += decoder.decode(read.value, { stream: true });
            yield* drainSseBuffer<TValue>(
                () => buffer,
                (next) => {
                    buffer = next;
                },
            );
        }
        buffer += decoder.decode();
        yield* drainSseBuffer<TValue>(
            () => buffer,
            (next) => {
                buffer = next;
            },
        );
    } finally {
        reader.releaseLock();
    }
}

function* drainSseBuffer<TValue>(getBuffer: () => string, setBuffer: (value: string) => void): Generator<TValue> {
    let buffer = getBuffer();
    while (true) {
        const index = buffer.indexOf("\n\n");
        if (index < 0) {
            setBuffer(buffer);
            return;
        }
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = block
            .split(/\r?\n/u)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
        if (!data) {
            continue;
        }
        if (data === "[DONE]") {
            setBuffer("");
            return;
        }
        yield JSON.parse(data) as TValue;
    }
}
