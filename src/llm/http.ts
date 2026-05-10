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
